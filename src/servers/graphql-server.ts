import { createServer } from "http"
import crypto from "crypto"

import { Accounts, Users } from "@app"
import { CustomError } from "@core/error"
import { getApolloConfig, getGeetestConfig, isDev, isProd, JWT_SECRET } from "@config"
import Geetest from "@services/geetest"
import { baseLogger } from "@services/logger"
import {
  ACCOUNT_USERNAME,
  addAttributesToCurrentSpan,
  addAttributesToCurrentSpanAndPropagate,
  SemanticAttributes,
} from "@services/tracing"
import {
  ApolloServerPluginDrainHttpServer,
  ApolloServerPluginLandingPageDisabled,
  ApolloServerPluginLandingPageGraphQLPlayground,
  ApolloServerPluginUsageReporting,
} from "apollo-server-core"
import { ApolloError, ApolloServer } from "apollo-server-express"
import express from "express"
import expressJwt from "express-jwt"
import { execute, GraphQLError, subscribe } from "graphql"
import { rule } from "graphql-shield"
import helmet from "helmet"
import * as jwt from "jsonwebtoken"
import pino from "pino"
import PinoHttp from "pino-http"
import {
  ExecuteFunction,
  SubscribeFunction,
  SubscriptionServer,
} from "subscriptions-transport-ws"

import { parseIps } from "@domain/users-ips"

import { playgroundTabs } from "../graphql/playground"

import healthzHandler from "./middlewares/healthz"
import authRouter from "./auth-router"

const graphqlLogger = baseLogger.child({
  module: "graphql",
})

const apolloConfig = getApolloConfig()

export const isAuthenticated = rule({ cache: "contextual" })((parent, args, ctx) => {
  return ctx.uid !== null ? true : "NOT_AUTHENTICATED"
})

export const isEditor = rule({ cache: "contextual" })(
  (parent, args, ctx: GraphQLContextForUser) => {
    return ctx.domainUser.isEditor ? true : "NOT_AUTHORIZED"
  },
)

const geeTestConfig = getGeetestConfig()
const geetest = Geetest(geeTestConfig)

const sessionContext = ({ token, ip, body }): Promise<GraphQLContext> => {
  const userId = token?.uid ?? null

  // TODO move from crypto.randomUUID() to a Jaeger standard
  const logger = graphqlLogger.child({ token, id: crypto.randomUUID(), body })

  let domainUser: User | null = null
  let domainAccount: Account | undefined
  return addAttributesToCurrentSpanAndPropagate(
    {
      [SemanticAttributes.ENDUSER_ID]: userId,
      [SemanticAttributes.HTTP_CLIENT_IP]: ip,
    },
    async () => {
      if (userId) {
        const loggedInUser = await Users.getUserForLogin({ userId, ip, logger })
        if (loggedInUser instanceof Error)
          throw new ApolloError("Invalid user authentication", "INVALID_AUTHENTICATION", {
            reason: loggedInUser,
          })
        domainUser = loggedInUser

        const loggedInDomainAccount = await Accounts.getAccount(
          domainUser.defaultAccountId,
        )
        if (loggedInDomainAccount instanceof Error) throw Error
        domainAccount = loggedInDomainAccount
      }

      addAttributesToCurrentSpan({ [ACCOUNT_USERNAME]: domainAccount?.username })

      return {
        logger,
        uid: userId,
        // FIXME: we should not return this for the admin graphql endpoint
        domainUser,
        domainAccount,
        geetest,
        ip,
      }
    },
  )
}

export const startApolloServer = async ({
  schema,
  port,
  startSubscriptionServer = false,
  enableApolloUsageReporting = false,
}): Promise<Record<string, unknown>> => {
  const app = express()
  const httpServer = createServer(app)

  const apolloPulgins = [
    ApolloServerPluginDrainHttpServer({ httpServer }),
    apolloConfig.playground
      ? ApolloServerPluginLandingPageGraphQLPlayground({
          settings: { "schema.polling.enable": false },
          tabs: [
            {
              endpoint: apolloConfig.playgroundUrl,
              ...playgroundTabs.default,
            },
          ],
        })
      : ApolloServerPluginLandingPageDisabled(),
  ]

  if (isProd && enableApolloUsageReporting) {
    apolloPulgins.push(
      ApolloServerPluginUsageReporting({
        rewriteError(err) {
          graphqlLogger.error(err, "Error caught in rewriteError")
          return err
        },
      }),
    )
  }

  const apolloServer = new ApolloServer({
    schema,
    introspection: apolloConfig.playground,
    plugins: apolloPulgins,
    context: async (context) => {
      // @ts-expect-error: TODO
      const token = context.req?.token ?? null

      const body = context.req?.body ?? null

      const ipString = isDev
        ? context.req?.ip
        : context.req?.headers["x-real-ip"] || context.req?.headers["x-forwarded-for"]

      const ip = parseIps(ipString)

      return sessionContext({
        token,
        ip,
        body,
      })
    },
    formatError: (err) => {
      const exception = err.extensions?.exception as unknown as CustomError
      const log = exception.log

      // An err object needs to necessarily have the forwardToClient field to be forwarded
      // i.e. catch-all errors will not be forwarded
      if (log) {
        const errObj = { message: err.message, code: err.extensions?.code }

        // we are logging additional details but not sending those to the client
        // ex: fields that indicate whether a payment succeeded or not, or stacktraces, that are required
        // for metrics or debugging
        // the err.extensions.metadata field contains such fields
        // log({ ...errObj, ...err?.extensions?.metadata })
        if (exception?.forwardToClient) {
          return errObj
        }
      } else {
        graphqlLogger.error(err)
      }

      // GraphQL shield seems to have a bug around throwing a custom ApolloError
      // This is a workaround for now
      const isShieldError = ["NOT_AUTHENTICATED", "NOT_AUTHORIZED"].includes(err.message)

      const reportErrorToClient =
        ["GRAPHQL_PARSE_FAILED", "GRAPHQL_VALIDATION_FAILED", "BAD_USER_INPUT"].includes(
          // err.extensions?.code,
          err.toString(),
        ) ||
        isShieldError ||
        err instanceof ApolloError ||
        err instanceof GraphQLError

      const reportedError = {
        message: err.message,
        locations: err.locations,
        path: err.path,
        code: isShieldError ? err.message : err.extensions?.code,
      }

      return reportErrorToClient
        ? reportedError
        : {
            message: `Error processing GraphQL request ${reportedError.code}`,
          }
    },
  })

  app.use("/auth", authRouter)

  app.use(
    helmet({
      contentSecurityPolicy: apolloConfig.playground ? false : undefined,
    }),
  )

  app.use(
    PinoHttp({
      logger: graphqlLogger,
      wrapSerializers: false,

      // Define custom serializers
      serializers: {
        // TODO: sanitize
        err: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: (res) => ({
          // FIXME: kind of a hack. body should be in in req. but have not being able to do it.
          body: res.req.body,
          ...pino.stdSerializers.res(res),
        }),
      },
      autoLogging: {
        ignorePaths: ["/healthz"],
      },
    }),
  )

  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET env variable is missing")
  }

  app.use(
    expressJwt({
      secret: JWT_SECRET,
      algorithms: ["HS256"],
      credentialsRequired: false,
      requestProperty: "token",
    }),
  )

  // Health check
  app.get(
    "/healthz",
    healthzHandler({
      checkDbConnectionStatus: true,
      checkRedisStatus: true,
      checkLndsStatus: false,
    }),
  )

  await apolloServer.start()

  apolloServer.applyMiddleware({ app, path: "/graphql" })

  return new Promise((resolve, reject) => {
    httpServer.listen({ port }, () => {
      if (startSubscriptionServer) {
        const apolloSubscriptionServer = new SubscriptionServer(
          {
            execute: execute as unknown as ExecuteFunction,
            subscribe: subscribe as unknown as SubscribeFunction,
            schema,
            async onConnect(connectionParams, webSocket, connectionContext) {
              const { request } = connectionContext

              let token: string | jwt.JwtPayload | null = null
              const authz =
                connectionParams.authorization || connectionParams.Authorization
              if (authz) {
                const rawToken = authz.slice(7)
                token = jwt.decode(rawToken)
              }

              return sessionContext({
                token,
                ip: request?.socket?.remoteAddress,

                // TODO: Resolve what's needed here
                body: null,
              })
            },
          },
          {
            server: httpServer,
            path: apolloServer.graphqlPath,
          },
        )
        ;["SIGINT", "SIGTERM"].forEach((signal) => {
          process.on(signal, () => apolloSubscriptionServer.close())
        })
      }

      console.log(
        `🚀 Server ready at http://localhost:${port}${apolloServer.graphqlPath}`,
      )
      resolve({ app, httpServer, apolloServer })
    })

    httpServer.on("error", (err) => {
      console.error(err)
      reject(err)
    })
  })
}
