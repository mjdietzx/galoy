/**
 * an accounting reminder:
 * https://en.wikipedia.org/wiki/Double-entry_bookkeeping
 */

import { toSats } from "@domain/bitcoin"
import {
  LedgerTransactionType,
  liabilitiesMainAccount,
  toLiabilitiesWalletId,
  toWalletId,
} from "@domain/ledger"
import { BalanceLessThanZeroError } from "@domain/errors"
import {
  CouldNotFindTransactionError,
  LedgerError,
  LedgerServiceError,
  UnknownLedgerError,
} from "@domain/ledger/errors"
import { ErrorLevel } from "@domain/shared"
import { toObjectId } from "@services/mongoose/utils"
import {
  recordExceptionInCurrentSpan,
  wrapAsyncFunctionsToRunInSpan,
} from "@services/tracing"
import { baseLogger } from "@services/logger"

import { admin } from "./admin"
import * as adminLegacy from "./admin-legacy"
import { MainBook, Transaction } from "./books"
import * as caching from "./caching"
import { TransactionsMetadataRepository } from "./services"
import { intraledger } from "./intraledger"
import { receive } from "./receive"
import { send } from "./send"
import { volume } from "./volume"

export const lazyLoadLedgerAdmin = ({
  bankOwnerWalletResolver,
  dealerBtcWalletResolver,
  dealerUsdWalletResolver,
  funderWalletResolver,
}: LoadLedgerParams) => {
  caching.setBankOwnerWalletResolver(bankOwnerWalletResolver)
  caching.setDealerBtcWalletResolver(dealerBtcWalletResolver)
  caching.setDealerUsdWalletResolver(dealerUsdWalletResolver)
  caching.setFunderWalletResolver(funderWalletResolver)
  return {
    ...adminLegacy,
  }
}

const txnMetadataRepo = TransactionsMetadataRepository()

export const LedgerService = (): ILedgerService => {
  const updateMetadataByHash = async (
    ledgerTxMetadata:
      | OnChainLedgerTransactionMetadataUpdate
      | LnLedgerTransactionMetadataUpdate,
  ): Promise<true | LedgerServiceError | RepositoryError> =>
    TransactionsMetadataRepository().updateByHash(ledgerTxMetadata)

  const getTransactionById = async (
    id: LedgerTransactionId,
  ): Promise<LedgerTransaction | LedgerServiceError> => {
    let txnRecord: TransactionRecord
    try {
      const _id = toObjectId<LedgerTransactionId>(id)
      const { results } = await MainBook.ledger({
        account_path: liabilitiesMainAccount,
        _id,
      })
      txnRecord = results[0]
      if (results.length !== 1) {
        return new CouldNotFindTransactionError()
      }
    } catch (err) {
      return new UnknownLedgerError(err)
    }

    return translateTxRecordsToLedgerTxs([txnRecord])[0]
  }

  const getTransactionsByHash = async (
    hash: PaymentHash | OnChainTxHash,
  ): Promise<LedgerTransaction[] | LedgerServiceError> => {
    let txnRecords: TransactionRecord[]
    try {
      ;({ results: txnRecords } = await MainBook.ledger({
        account_path: liabilitiesMainAccount,
        hash,
      }))
      return translateTxRecordsToLedgerTxs(txnRecords)
    } catch (err) {
      return new UnknownLedgerError(err)
    }
  }

  const getTransactionsByWalletId = async (
    walletId: WalletId,
  ): Promise<LedgerTransaction[] | LedgerError> => {
    const liabilitiesWalletId = toLiabilitiesWalletId(walletId)
    let txnRecords: TransactionRecord[]
    try {
      ;({ results: txnRecords } = await MainBook.ledger({
        account: liabilitiesWalletId,
      }))
      return translateTxRecordsToLedgerTxs(txnRecords)
    } catch (err) {
      return new UnknownLedgerError(err)
    }
  }

  const getTransactionsByWalletIdAndContactUsername = async (
    walletId: WalletId,
    contactUsername,
  ): Promise<LedgerTransaction[] | LedgerError> => {
    const liabilitiesWalletId = toLiabilitiesWalletId(walletId)
    let txnRecords: TransactionRecord[]
    try {
      ;({ results: txnRecords } = await MainBook.ledger({
        account: liabilitiesWalletId,
        username: contactUsername,
      }))
      return translateTxRecordsToLedgerTxs(txnRecords)
    } catch (err) {
      return new UnknownLedgerError(err)
    }
  }

  const listPendingPayments = async (
    walletId: WalletId,
  ): Promise<LedgerTransaction[] | LedgerError> => {
    const liabilitiesWalletId = toLiabilitiesWalletId(walletId)
    let txnRecords: TransactionRecord[]
    try {
      ;({ results: txnRecords } = await MainBook.ledger({
        account: liabilitiesWalletId,
        type: LedgerTransactionType.Payment,
        pending: true,
      }))
      return translateTxRecordsToLedgerTxs(txnRecords)
    } catch (err) {
      return new UnknownLedgerError(err)
    }
  }

  async function* listAllPaymentHashes(): AsyncGenerator<PaymentHash | LedgerError> {
    const aggregationParams = [
      {
        $match: {
          type: LedgerTransactionType.Payment,
        },
      },
      {
        $group: {
          _id: "$hash",
          createdAt: { $first: "$timestamp" },
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
    ]

    try {
      const agg = Transaction.aggregate(aggregationParams)
        .cursor({ batchSize: 100 })
        .exec()
      for await (const { _id } of agg) {
        yield _id
      }
    } catch (err) {
      yield new UnknownLedgerError(err)
    }
  }

  const getPendingPaymentsCount = async (
    walletId: WalletId,
  ): Promise<number | LedgerError> => {
    const liabilitiesWalletId = toLiabilitiesWalletId(walletId)
    return Transaction.countDocuments({
      accounts: liabilitiesWalletId,
      type: LedgerTransactionType.Payment,
      pending: true,
    })
  }

  const getWalletBalance = async (
    walletId: WalletId,
  ): Promise<Satoshis | LedgerError> => {
    const liabilitiesWalletId = toLiabilitiesWalletId(walletId)
    try {
      const { balance } = await MainBook.balance({
        account: liabilitiesWalletId,
      })
      if (balance < 0) {
        recordExceptionInCurrentSpan({
          error: new BalanceLessThanZeroError(balance),
          attributes: {
            "getWalletBalance.error.invalidBalance": `${balance}`,
          },
          level: ErrorLevel.Critical,
        })
      }
      return toSats(balance)
    } catch (err) {
      return new UnknownLedgerError(err)
    }
  }

  const isOnChainTxRecorded = async ({
    walletId,
    txHash,
  }: {
    walletId: WalletId
    txHash: OnChainTxHash
  }): Promise<boolean | LedgerServiceError> => {
    const liabilitiesWalletId = toLiabilitiesWalletId(walletId)

    try {
      const result = await Transaction.countDocuments({
        accounts: liabilitiesWalletId,
        type: LedgerTransactionType.OnchainReceipt,
        hash: txHash,
      })
      return result > 0
    } catch (err) {
      return new UnknownLedgerError(err)
    }
  }

  const isLnTxRecorded = async (
    paymentHash: PaymentHash,
  ): Promise<boolean | LedgerServiceError> => {
    try {
      const { total } = await MainBook.ledger({
        pending: false,
        hash: paymentHash,
      })
      return total > 0
    } catch (err) {
      return new UnknownLedgerError(err)
    }
  }

  const getWalletIdByTransactionHash = async (
    hash: OnChainTxHash,
  ): Promise<WalletId | LedgerServiceError> => {
    const bankOwnerWalletId = await caching.getBankOwnerWalletId()
    const bankOwnerPath = toLiabilitiesWalletId(bankOwnerWalletId)
    const entry = await Transaction.findOne({
      account_path: liabilitiesMainAccount,
      accounts: { $ne: bankOwnerPath },
      hash,
    })
    if (!entry) {
      return new CouldNotFindTransactionError()
    }
    const walletId = toWalletId(entry.accounts as LiabilitiesWalletId)
    if (!walletId) {
      return new UnknownLedgerError("no wallet id associated to transaction")
    }
    return walletId
  }

  const listWalletIdsWithPendingPayments = async function* ():
    | AsyncGenerator<WalletId>
    | LedgerServiceError {
    let transactions
    try {
      transactions = Transaction.aggregate([
        {
          $match: {
            type: "payment",
            pending: true,
            account_path: liabilitiesMainAccount,
          },
        },
        { $group: { _id: "$accounts" } },
      ])
        .cursor({ batchSize: 100 })
        .exec()
    } catch (error) {
      return new UnknownLedgerError(error)
    }

    for await (const { _id } of transactions) {
      yield toWalletId(_id)
    }
  }

  return wrapAsyncFunctionsToRunInSpan({
    namespace: "services.ledger",
    fns: {
      updateMetadataByHash,
      getTransactionById,
      getTransactionsByHash,
      getTransactionsByWalletId,
      getTransactionsByWalletIdAndContactUsername,
      listPendingPayments,
      listAllPaymentHashes,
      getPendingPaymentsCount,
      getWalletBalance,
      isOnChainTxRecorded,
      isLnTxRecorded,
      getWalletIdByTransactionHash,
      listWalletIdsWithPendingPayments,
      ...admin,
      ...intraledger,
      ...volume,
      ...send,
      ...receive,
    },
  })
}

const translateToLedgerTx = ({
  txnRecord,
  txnMetadata,
}: {
  txnRecord: TransactionRecord
  txnMetadata: LedgerTransactionMetadata | undefined
}): LedgerTransaction => {
  const fromTxnRecord = {
    id: txnRecord.id as LedgerTransactionId,
    walletId: toWalletId(txnRecord.accounts as LiabilitiesWalletId),
    type: txnRecord.type as LedgerTransactionType,
    debit: toSats(txnRecord.debit),
    credit: toSats(txnRecord.credit),
    fee: toSats(txnRecord.fee),
    usd: txnRecord.usd,
    feeUsd: txnRecord.feeUsd,
    currency: txnRecord.currency as WalletCurrency,
    timestamp: txnRecord.timestamp,
    pendingConfirmation: txnRecord.pending,
    journalId: txnRecord._journal.toString(),
    lnMemo: txnRecord.memo,
    username: (txnRecord.username as Username) || undefined,
    memoFromPayer: txnRecord.memoPayer,
    paymentHash: (txnRecord.hash as PaymentHash) || undefined,
    pubkey: (txnRecord.pubkey as Pubkey) || undefined,
    address:
      txnRecord.payee_addresses && txnRecord.payee_addresses.length > 0
        ? (txnRecord.payee_addresses[0] as OnChainAddress)
        : undefined,
    txHash: (txnRecord.hash as OnChainTxHash) || undefined,
    feeKnownInAdvance: txnRecord.feeKnownInAdvance || false,
  }

  if (txnMetadata === undefined) return fromTxnRecord

  let fromTxnMetadata: PartialLedgerTransactionFromMetadata = {}
  if ("revealedPreImage" in txnMetadata) {
    fromTxnMetadata = { revealedPreImage: txnMetadata.revealedPreImage }
  }
  return { ...fromTxnRecord, ...fromTxnMetadata }
}

const translateTxRecordsToLedgerTxs = async (
  txnRecords: TransactionRecord[],
): Promise<LedgerTransaction[]> => {
  const txnsMetadata = await Promise.all(
    txnRecords.map(async (tx): Promise<LedgerTransactionMetadata | undefined> => {
      const txnMetadataResult = await txnMetadataRepo.findById(
        tx.id as LedgerTransactionId,
      )

      if (txnMetadataResult instanceof Error) {
        if (!(txnMetadataResult instanceof CouldNotFindTransactionError)) {
          baseLogger.error(
            { error: txnMetadataResult },
            `could not fetch transaction metadata for id '${tx.id}'`,
          )
        }
        return undefined
      }

      return txnMetadataResult
    }),
  )

  return txnRecords.map((txnRecord, i) =>
    translateToLedgerTx({
      txnRecord,
      txnMetadata: txnsMetadata[i],
    }),
  )
}

export const translateToLedgerJournal = (savedEntry): LedgerJournal => ({
  journalId: savedEntry._id.toString(),
  voided: savedEntry.voided,
  transactionIds: savedEntry._transactions.map((id) => id.toString()),
})
