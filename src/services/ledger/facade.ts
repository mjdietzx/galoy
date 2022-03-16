import { UnknownLedgerError } from "@domain/ledger"

import { WalletCurrency } from "@domain/shared"

import { MainBook } from "./books"
import { EntryBuilder, toLedgerAccountId } from "./domain"
import { persistAndReturnEntry } from "./helpers"
import * as caching from "./caching"
export * from "./tx-metadata"

const ZERO_SATS = {
  currency: WalletCurrency.Btc,
  amount: 0n,
} as const

const staticAccountIds = async () => {
  return {
    bankOwnerAccountId: toLedgerAccountId(await caching.getBankOwnerWalletId()),
    dealerBtcAccountId: toLedgerAccountId(await caching.getDealerBtcWalletId()),
    dealerUsdAccountId: toLedgerAccountId(await caching.getDealerUsdWalletId()),
  }
}

type WalletDescriptor<T extends WalletCurrency> = {
  id: WalletId
  currency: T
}

type RecordSendArgs<T extends WalletCurrency> = {
  description: string
  senderWalletDescriptor: WalletDescriptor<T>
  amount: T extends "BTC"
    ? BtcPaymentAmount
    : {
        usd: UsdPaymentAmount
        btc: BtcPaymentAmount
      }
  metadata: SendLedgerMetadata
  fee?: BtcPaymentAmount
}

type RecordReceiveArgs<T extends WalletCurrency> = {
  description: string
  receiverWalletDescriptor: WalletDescriptor<T>
  amount: T extends "BTC"
    ? BtcPaymentAmount
    : {
        usd: UsdPaymentAmount
        btc: BtcPaymentAmount
      }
  metadata: ReceiveLedgerMetadata
  fee?: BtcPaymentAmount
}

type RecordIntraledgerArgs<T extends WalletCurrency, V extends WalletCurrency> = {
  description: string
  senderWalletDescriptor: WalletDescriptor<T>
  receiverWalletDescriptor: WalletDescriptor<V>
  amount: V extends T
    ? PaymentAmount<T>
    : {
        usd: UsdPaymentAmount
        btc: BtcPaymentAmount
      }
  metadata: IntraledgerLedgerMetadata
}

export const recordSend = async <T extends WalletCurrency>({
  description,
  senderWalletDescriptor,
  amount,
  fee,
  metadata,
}: RecordSendArgs<T>) => {
  const actualFee = fee || ZERO_SATS

  let entry = MainBook.entry(description)
  const builder = EntryBuilder({
    staticAccountIds: await staticAccountIds(),
    entry,
    metadata,
  }).withFee(actualFee)

  if (senderWalletDescriptor.currency === WalletCurrency.Usd) {
    const { usd, btc } = amount as { usd: UsdPaymentAmount; btc: BtcPaymentAmount }
    entry = builder
      .debitAccount({
        accountId: toLedgerAccountId(senderWalletDescriptor.id),
        amount: usd,
      })
      .creditLnd(btc)
  } else {
    entry = builder
      .debitAccount({
        accountId: toLedgerAccountId(senderWalletDescriptor.id),
        amount: amount as BtcPaymentAmount,
      })
      .creditLnd()
  }

  return persistAndReturnEntry({ entry, hash: metadata.hash })
}

export const recordReceive = async <T extends WalletCurrency>({
  description,
  receiverWalletDescriptor,
  amount,
  fee,
  metadata,
}: RecordReceiveArgs<T>) => {
  const actualFee = fee || ZERO_SATS

  let entry = MainBook.entry(description)
  const builder = EntryBuilder({
    staticAccountIds: await staticAccountIds(),
    entry,
    metadata,
  }).withFee(actualFee)

  if (receiverWalletDescriptor.currency === WalletCurrency.Usd) {
    const { usd, btc } = amount as { usd: UsdPaymentAmount; btc: BtcPaymentAmount }
    entry = builder.debitLnd(btc).creditAccount({
      accountId: toLedgerAccountId(receiverWalletDescriptor.id),
      usdAmountForBtcDebit: usd,
    })
  } else {
    entry = builder.debitLnd(amount as BtcPaymentAmount).creditAccount({
      accountId: toLedgerAccountId(receiverWalletDescriptor.id),
    })
  }

  return persistAndReturnEntry({ entry, hash: metadata.hash })
}

export const getLedgerAccountBalanceForWalletId = async <T extends WalletCurrency>({
  id: walletId,
  currency: walletCurrency,
}: WalletDescriptor<T>): Promise<PaymentAmount<T> | LedgerError> => {
  try {
    const { balance } = await MainBook.balance({
      account: toLedgerAccountId(walletId),
    })
    return { amount: BigInt(balance), currency: walletCurrency }
  } catch (err) {
    return new UnknownLedgerError(err)
  }
}

export const recordIntraledger = async <
  T extends WalletCurrency,
  V extends WalletCurrency,
>({
  description,
  senderWalletDescriptor,
  receiverWalletDescriptor,
  amount,
  metadata,
}: RecordIntraledgerArgs<T, V>) => {
  let entry = MainBook.entry(description)
  const builder = EntryBuilder({
    staticAccountIds: await staticAccountIds(),
    entry,
    metadata,
  }).withoutFee()

  // @ts-ignore
  if (senderWalletDescriptor.currency === receiverWalletDescriptor.currency) {
    entry = builder
      .debitAccount({
        accountId: toLedgerAccountId(senderWalletDescriptor.id),
        amount: amount as PaymentAmount<T>,
      })
      .creditAccount({
        accountId: toLedgerAccountId(receiverWalletDescriptor.id),
      })
  } else {
    const { usd, btc } = amount as { usd: UsdPaymentAmount; btc: BtcPaymentAmount }

    if (senderWalletDescriptor.currency === WalletCurrency.Usd) {
      entry = builder
        .debitAccount({
          accountId: toLedgerAccountId(senderWalletDescriptor.id),
          amount: usd,
        })
        .creditAccount({
          accountId: toLedgerAccountId(receiverWalletDescriptor.id),
          btcAmountForUsdDebit: btc,
        })
    } else {
      entry = builder
        .debitAccount({
          accountId: toLedgerAccountId(senderWalletDescriptor.id),
          amount: btc,
        })
        .creditAccount({
          accountId: toLedgerAccountId(receiverWalletDescriptor.id),
          usdAmountForBtcDebit: usd,
        })
    }
  }
  return persistAndReturnEntry({entry, hash: "hash" in metadata ? metadata.hash : undefined })
}
