import { AmountCalculator, WalletCurrency } from "@domain/shared"

import { coldStorageAccountDescriptor, coldStorageAccountId, lndLedgerAccountDescriptor, lndLedgerAccountId } from "./accounts"

export const ZERO_SATS = {
  currency: WalletCurrency.Btc,
  amount: 0n,
} as const

const calc = AmountCalculator()

export const EntryBuilder = <M extends MediciEntry>({
  staticAccountIds,
  entry,
  metadata,
}: EntryBuilderConfig<M>) => {
  const withFee = (fee: BtcPaymentAmount) => {
    let applyFee: (amount: BtcPaymentAmount) => BtcPaymentAmount

    if (fee.amount > 0n) {
      entry.credit(staticAccountIds.bankOwnerAccountId, Number(fee.amount), {
        ...metadata,
        currency: fee.currency,
      })
      applyFee = (amount) => calc.sub(amount, fee)
    }
    else {
      applyFee = (amount) => amount
    }

    return EntryBuilderAmount({ metadata, entry, applyFee, staticAccountIds })
  }

  const withFeeFromBank = (fee: BtcPaymentAmount) => {
    let applyFee: (amount: BtcPaymentAmount) => BtcPaymentAmount

    if (fee.amount > 0n) {
      entry.debit(staticAccountIds.bankOwnerAccountId, Number(fee.amount), {
        ...metadata,
        currency: fee.currency
      })
      applyFee = (amount) => calc.add(amount, fee)
    }
    else {
      applyFee = (amount) => amount
    }

    return EntryBuilderAmount({ metadata, entry, applyFee, staticAccountIds })
  }

  return {
    withFee,
    withFeeFromBank,
  }
}

const EntryBuilderAmount = <M extends MediciEntry>({
  entry,
  metadata,
  applyFee,
  staticAccountIds,
}: EntryBuilderAmountState<M>): EntryBuilderAmount<M> => {
  const withAmount = ({ usd, btc }: { usd: UsdPaymentAmount, btc: BtcPaymentAmount }) => {
    return EntryBuilderDebit({
      entry,
      metadata,
      applyFee,
      staticAccountIds,
      amount: {
        usd,
        btc
      }
    })
  }

  return {
    withAmount
  }
}

const EntryBuilderDebit = <M extends MediciEntry>({
  entry,
  metadata,
  applyFee,
  staticAccountIds,
  amount: {
    usd,
    btc
  }
}: EntryBuilderDebitState<M>): EntryBuilderDebit<M> => {
  const debitAccount = <T extends WalletCurrency>({
    accountDescriptor,
    additionalMetadata,
  }: {
    accountDescriptor: LedgerAccountDescriptor<T>
    additionalMetadata?: TxMetadata
  }): EntryBuilderCredit<M> => {
    const debitMetadata = additionalMetadata
      ? { ...metadata, ...additionalMetadata }
      : metadata

    if (accountDescriptor.currency === WalletCurrency.Btc) {
      entry.debit(accountDescriptor.id, Number(btc.amount), {
        ...debitMetadata,
        currency: btc.currency,
      })
    } 
    else {
      entry.debit(accountDescriptor.id, Number(usd.amount), {
        ...debitMetadata,
        currency: usd.currency,
      })
    }

    return EntryBuilderCredit({
      entry,
      metadata,
      applyFee,
      debitCurrency: accountDescriptor.currency,
      amount: {
        usd,
        btc
      },
      staticAccountIds,
    }) as EntryBuilderCredit<M>
  }

  const debitLnd = (): EntryBuilderCredit<M> => {
    return debitAccount({accountDescriptor: lndLedgerAccountDescriptor})
  }

  const debitColdStorage = (): EntryBuilderCredit<M> => {
    return debitAccount({accountDescriptor: coldStorageAccountDescriptor})
  }

  return {
    debitAccount,
    debitLnd,
    debitColdStorage
  }
}

type EntryBuilderCreditState<M extends MediciEntry> = {
  entry: M
  metadata: TxMetadata
  applyFee: (amount: BtcPaymentAmount) => BtcPaymentAmount
  debitCurrency: WalletCurrency
  amount: {
    usd: UsdPaymentAmount,
    btc: BtcPaymentAmount
  }
  staticAccountIds: {
    dealerBtcAccountId: LedgerAccountId
    dealerUsdAccountId: LedgerAccountId
  }
}

const EntryBuilderCredit = <M extends MediciEntry>({
  entry,
  metadata,
  applyFee,
  amount: {
    usd,
    btc,
  },
  debitCurrency,
  staticAccountIds,
}: EntryBuilderCreditState<M>): EntryBuilderCredit<M> => {
  const creditLnd = () => creditAccount(lndLedgerAccountDescriptor)
  const creditColdStorage = () => creditAccount(coldStorageAccountDescriptor)

  const creditAccount = <T extends WalletCurrency>(
    accountDescriptor: LedgerAccountDescriptor<T>) => {
    
    if (debitCurrency !== accountDescriptor.currency) {
      const dealerData = {
        entry,
        metadata,
        staticAccountIds,
        btcAmount: btc,
        usdAmount: usd,
      }

      debitCurrency === WalletCurrency.Usd ? addUsdToDealer(dealerData) : withdrawUsdFromDealer(dealerData)
    }

    const creditAmount = accountDescriptor.currency === WalletCurrency.Usd ? usd : applyFee(btc)
    
    entry.credit(accountDescriptor.id, Number(creditAmount.amount), {
      ...metadata,
      currency: creditAmount.currency,
    })
    return entry
  }

  return {
    creditLnd,
    creditAccount,
    creditColdStorage
  }
}

const addUsdToDealer = ({
  staticAccountIds: { dealerBtcAccountId, dealerUsdAccountId },
  entry,
  btcAmount,
  usdAmount,
  metadata,
}: {
  staticAccountIds: {
    dealerBtcAccountId: LedgerAccountId
    dealerUsdAccountId: LedgerAccountId
  }
  entry: MediciEntry
  btcAmount: BtcPaymentAmount
  usdAmount: UsdPaymentAmount
  metadata: TxMetadata
}) => {
  entry.credit(dealerBtcAccountId, Number(btcAmount.amount), {
    ...metadata,
    currency: btcAmount.currency,
  })
  entry.debit(dealerUsdAccountId, Number(usdAmount.amount), {
    ...metadata,
    currency: usdAmount.currency,
  })
  return entry
}

const withdrawUsdFromDealer = ({
  staticAccountIds: { dealerBtcAccountId, dealerUsdAccountId },
  entry,
  btcAmount,
  usdAmount,
  metadata,
}: {
  staticAccountIds: {
    dealerBtcAccountId: LedgerAccountId
    dealerUsdAccountId: LedgerAccountId
  }
  entry: MediciEntry
  btcAmount: BtcPaymentAmount
  usdAmount: UsdPaymentAmount
  metadata: TxMetadata
}) => {
  entry.debit(dealerBtcAccountId, Number(btcAmount.amount), {
    ...metadata,
    currency: btcAmount.currency,
  })
  entry.credit(dealerUsdAccountId, Number(usdAmount.amount), {
    ...metadata,
    currency: usdAmount.currency,
  })
  return entry
}
