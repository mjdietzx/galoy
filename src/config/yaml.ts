import fs from "fs"

import yaml from "js-yaml"
import merge from "lodash.merge"

import { baseLogger } from "@services/logger"
import { checkedToScanDepth } from "@domain/bitcoin/onchain"
import { checkedToTargetConfs, toSats } from "@domain/bitcoin"
import Ajv from "ajv"
import { toCents } from "@domain/fiat"

import { WithdrawalFeePriceMethod } from "@domain/wallets"

import { ConfigSchema, configSchema } from "./schema"
import { ConfigError } from "./error"

const defaultContent = fs.readFileSync("./default.yaml", "utf8")
const defaultConfig = yaml.load(defaultContent)

let customContent, customConfig

try {
  customContent = fs.readFileSync("/var/yaml/custom.yaml", "utf8")
  customConfig = yaml.load(customContent)
} catch (err) {
  baseLogger.info({ err }, "no custom.yaml available. using default values")
}

export const yamlConfig = merge(defaultConfig, customConfig)

const ajv = new Ajv()
const validate = ajv.compile<ConfigSchema>(configSchema)
const valid = validate(yamlConfig)
if (!valid) {
  baseLogger.error({ validationErrors: validate.errors }, "Invalid yaml configuration")
  throw new ConfigError("Invalid yaml configuration", validate.errors)
}

export const MEMO_SHARING_SATS_THRESHOLD = yamlConfig.spamLimits.memoSharingSatsThreshold

export const ONCHAIN_MIN_CONFIRMATIONS = yamlConfig.onChainWallet.minConfirmations
// how many block are we looking back for getChainTransactions
const getOnChainScanDepth = (val: number): ScanDepth => {
  const scanDepth = checkedToScanDepth(val)
  if (scanDepth instanceof Error) throw scanDepth
  return scanDepth
}
export const ONCHAIN_SCAN_DEPTH = getOnChainScanDepth(yamlConfig.onChainWallet.scanDepth)
export const ONCHAIN_SCAN_DEPTH_OUTGOING = getOnChainScanDepth(
  yamlConfig.onChainWallet.scanDepthOutgoing,
)
export const ONCHAIN_SCAN_DEPTH_CHANNEL_UPDATE = getOnChainScanDepth(
  yamlConfig.onChainWallet.scanDepthChannelUpdate,
)

export const USER_ACTIVENESS_MONTHLY_VOLUME_THRESHOLD = toCents(
  yamlConfig.userActivenessMonthlyVolumeThreshold,
)

export const getGaloyInstanceName = (): string => yamlConfig.name

export const getLndParams = (): LndParams[] => {
  const lnds = yamlConfig.lnds

  lnds.forEach((input) => {
    const keys = ["_TLS", "_MACAROON", "_DNS", "_PUBKEY"]
    keys.forEach((key) => {
      if (!process.env[`${input.name}${key}`]) {
        throw new ConfigError(`lnd params missing for: ${input.name}${key}`)
      }
    })
  })

  return lnds.map((input) => ({
    cert: process.env[`${input.name}_TLS`],
    macaroon: process.env[`${input.name}_MACAROON`],
    node: process.env[`${input.name}_DNS`],
    port: process.env[`${input.name}_RPCPORT`] ?? 10009,
    pubkey: process.env[`${input.name}_PUBKEY`],
    priority: 1, // will be overridden if present in the yaml
    ...input,
  }))
}

export const getFeesConfig = (feesConfig = yamlConfig.fees): FeesConfig => {
  const withdrawMethod = WithdrawalFeePriceMethod[feesConfig.withdraw.method]
  const withdrawRatio =
    withdrawMethod === WithdrawalFeePriceMethod.flat ? 0 : feesConfig.withdraw.ratio

  return {
    depositFeeVariable: feesConfig.deposit,
    depositFeeFixed: toSats(0),
    withdrawMethod,
    withdrawRatio,
    withdrawThreshold: feesConfig.withdraw.threshold,
    withdrawDaysLookback: feesConfig.withdraw.daysLookback,
    withdrawDefaultMin: toSats(feesConfig.withdraw.defaultMin),
  }
}

export const getAccountLimits = ({
  level,
  accountLimits = yamlConfig.accountLimits,
}: AccountLimitsArgs): IAccountLimits => {
  return {
    intraLedgerLimit: accountLimits.intraLedger.level[level],
    withdrawalLimit: accountLimits.withdrawal.level[level],
  }
}

export const getTwoFALimits = (): TwoFALimits => ({
  threshold: toCents(yamlConfig.twoFALimits.threshold),
})

const getRateLimits = (config): RateLimitOptions => {
  /**
   * Returns a subset of the required parameters for the
   * 'rate-limiter-flexible.RateLimiterRedis' object.
   */
  return {
    points: config.points,
    duration: config.duration,
    blockDuration: config.blockDuration,
  }
}

export const getRequestPhoneCodePerPhoneLimits = () =>
  getRateLimits(yamlConfig.rateLimits.requestPhoneCodePerPhone)

export const getRequestPhoneCodePerPhoneMinIntervalLimits = () =>
  getRateLimits(yamlConfig.rateLimits.requestPhoneCodePerPhoneMinInterval)

export const getRequestPhoneCodePerIpLimits = () =>
  getRateLimits(yamlConfig.rateLimits.requestPhoneCodePerIp)

export const getFailedLoginAttemptPerPhoneLimits = () =>
  getRateLimits(yamlConfig.rateLimits.failedLoginAttemptPerPhone)

export const getfailedLoginAttemptPerEmailAddressLimits = () =>
  getRateLimits(yamlConfig.rateLimits.failedLoginAttemptEmailAddress)

export const getFailedLoginAttemptPerIpLimits = () =>
  getRateLimits(yamlConfig.rateLimits.failedLoginAttemptPerIp)

export const getInvoiceCreateAttemptLimits = () =>
  getRateLimits(yamlConfig.rateLimits.invoiceCreateAttempt)

export const getInvoiceCreateForRecipientAttemptLimits = () =>
  getRateLimits(yamlConfig.rateLimits.invoiceCreateForRecipientAttempt)

export const getOnChainAddressCreateAttemptLimits = () =>
  getRateLimits(yamlConfig.rateLimits.onChainAddressCreateAttempt)

export const getOnChainWalletConfig = () => ({
  dustThreshold: yamlConfig.onChainWallet.dustThreshold,
})

export const getColdStorageConfig = (): ColdStorageConfig => {
  const config = yamlConfig.coldStorage

  const targetConfirmations = checkedToTargetConfs(config.targetConfirmations)
  if (targetConfirmations instanceof Error) throw targetConfirmations

  return {
    minOnChainHotWalletBalance: toSats(config.minOnChainHotWalletBalance),
    maxHotWalletBalance: toSats(config.maxHotWalletBalance),
    minRebalanceSize: toSats(config.minRebalanceSize),
    walletPattern: config.walletPattern,
    onChainWallet: config.onChainWallet,
    targetConfirmations,
  }
}

export const getBuildVersions = (): {
  minBuildNumberAndroid: number
  lastBuildNumberAndroid: number
  minBuildNumberIos: number
  lastBuildNumberIos: number
} => {
  const { android, ios } = yamlConfig.buildVersion

  return {
    minBuildNumberAndroid: android.minBuildNumber,
    lastBuildNumberAndroid: android.lastBuildNumber,
    minBuildNumberIos: ios.minBuildNumber,
    lastBuildNumberIos: ios.lastBuildNumber,
  }
}

export const PROXY_CHECK_APIKEY = yamlConfig?.PROXY_CHECK_APIKEY

export const getIpConfig = (config = yamlConfig): IpConfig => ({
  ipRecordingEnabled:
    process.env.NODE_ENV === "test" ? false : config.ipRecording?.enabled,
  proxyCheckingEnabled: config.ipRecording?.proxyChecking?.enabled,
})

export const getApolloConfig = (config = yamlConfig): ApolloConfig => config.apollo
export const getTwoFAConfig = (config = yamlConfig): TwoFAConfig => config.twoFALimits

export const LND_SCB_BACKUP_BUCKET_NAME = yamlConfig.lndScbBackupBucketName

export const getTestAccounts = (config = yamlConfig): TestAccount[] =>
  config.test_accounts

export const getCronConfig = (config = yamlConfig): CronConfig => config.cronConfig
export const getKratosConfig = (config = yamlConfig): KratosConfig => config.kratosConfig
