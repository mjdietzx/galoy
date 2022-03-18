import { JWT_SECRET, JWT_TOKEN_EXPIRES_IN } from "@config"
import jwt from "jsonwebtoken"

// TODO: replace network by uri of the server
// the uri will embed the network, ie: graphql.mainnet.server.io
// and provide more information than just the network
export const createToken = ({
  uid,
  network,
  kratosUserId,
}: {
  uid: UserId
  network: BtcNetwork
  kratosUserId?: KratosUserId
}): JwtToken => {
  return jwt.sign({ uid, network, kratosUserId }, JWT_SECRET, {
    // TODO use asymmetric signature
    // and verify the signature from the client
    // otherwise we could get subject to DDos attack
    //
    // we will also need access token for this to work
    // otherwise, the client could still receive a fake invoice/on chain address
    // from a malicious address and the client app would not be able to
    // verify signature
    //
    // see: https://www.theregister.com/2018/04/24/myetherwallet_dns_hijack/
    algorithm: "HS256",
    expiresIn: JWT_TOKEN_EXPIRES_IN,
  }) as JwtToken
}
