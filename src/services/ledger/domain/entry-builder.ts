import { AmountCalculator, WalletCurrency } from "@domain/shared"

import { coldStorageAccountId, lndLedgerAccountId } from "./accounts"

const ZERO_SATS = {
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

    return EntryBuilderDebit({ metadata, entry, applyFee, staticAccountIds })
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

    return EntryBuilderDebit({ metadata, entry, applyFee, staticAccountIds })
  }

  const withoutFee = () => {
    return withFee(ZERO_SATS)
  }

  return {
    withFee,
    withFeeFromBank,
    withoutFee,
  }
}

const EntryBuilderDebit = <M extends MediciEntry>({
  entry,
  metadata,
  applyFee,
  staticAccountIds,
}: EntryBuilderDebitState<M>): EntryBuilderDebit<M> => {
  const debitAccount = <T extends WalletCurrency>({
    accountId,
    amount,
    additionalMetadata,
  }: {
    accountId: LedgerAccountId
    amount: PaymentAmount<T>
    additionalMetadata?: TxMetadata
  }): EntryBuilderCredit<M, T> => {
    const debitMetadata = additionalMetadata
      ? { ...metadata, ...additionalMetadata }
      : metadata
    entry.debit(accountId, Number(amount.amount), {
      ...debitMetadata,
      currency: amount.currency,
    })
    if (amount.currency === WalletCurrency.Btc) {
      return EntryBuilderCreditWithBtcDebit({
        entry,
        metadata,
        applyFee,
        debitAmount: amount as BtcPaymentAmount,
        staticAccountIds,
      }) as EntryBuilderCredit<M, T>
    }

    return EntryBuilderCreditWithUsdDebit({
      entry,
      metadata,
      applyFee,
      debitAmount: amount as UsdPaymentAmount,
      staticAccountIds,
    }) as EntryBuilderCredit<M, T>
  }

  const debitLnd = (amount: BtcPaymentAmount): EntryBuilderCreditWithBtcDebit<M> => {
    entry.debit(lndLedgerAccountId, Number(amount.amount), {
      ...metadata,
      currency: amount.currency,
    })
    return EntryBuilderCreditWithBtcDebit({
      entry,
      metadata,
      applyFee,
      debitAmount: amount as BtcPaymentAmount,
      staticAccountIds,
    }) as EntryBuilderCreditWithBtcDebit<M>
  }

  const debitColdStorage = (amount: BtcPaymentAmount): EntryBuilderCreditWithBtcDebit<M> => {
    entry.debit(coldStorageAccountId, Number(amount.amount), {
      ...metadata,
      currency: amount.currency,
    })
    return EntryBuilderCreditWithBtcDebit({
      entry,
      metadata,
      applyFee,
      debitAmount: amount as BtcPaymentAmount,
      staticAccountIds,
    }) as EntryBuilderCreditWithBtcDebit<M>
  }

  return {
    debitAccount,
    debitLnd,
    debitColdStorage
  }
}

type EntryBuilderCreditState<M extends MediciEntry, D extends WalletCurrency> = {
  entry: M
  metadata: TxMetadata
  applyFee: (amount: BtcPaymentAmount) => BtcPaymentAmount
  debitAmount: PaymentAmount<D>
  staticAccountIds: {
    dealerBtcAccountId: LedgerAccountId
    dealerUsdAccountId: LedgerAccountId
  }
}

const EntryBuilderCreditWithUsdDebit = <M extends MediciEntry>({
  entry,
  metadata,
  debitAmount,
  staticAccountIds,
  applyFee
}: EntryBuilderCreditState<M, "USD">): EntryBuilderCreditWithUsdDebit<M> => {
  const creditLnd = (btcAmountForUsdDebit: BtcPaymentAmount) => {
    withdrawUsdFromDealer({
      entry,
      metadata,
      staticAccountIds,
      btcAmount: btcAmountForUsdDebit,
      usdAmount: debitAmount,
    })
    const creditAmount = applyFee(btcAmountForUsdDebit)
    entry.credit(lndLedgerAccountId, Number(creditAmount.amount), {
      ...metadata,
      currency: btcAmountForUsdDebit.currency,
    })
    return entry
  }

  const creditColdStorage = (btcAmountForUsdDebit: BtcPaymentAmount) => {
    withdrawUsdFromDealer({
      entry,
      metadata,
      staticAccountIds,
      btcAmount: btcAmountForUsdDebit,
      usdAmount: debitAmount,
    })
    const creditAmount = applyFee(btcAmountForUsdDebit)
    entry.credit(coldStorageAccountId, Number(creditAmount.amount), {
      ...metadata,
      currency: btcAmountForUsdDebit.currency,
    })
    return entry
  }

  const creditAccount = ({
    accountId,
    btcAmountForUsdDebit,
  }: {
    accountId: LedgerAccountId
    btcAmountForUsdDebit?: BtcPaymentAmount
  }) => {
    if (btcAmountForUsdDebit) {
      withdrawUsdFromDealer({
        entry,
        metadata,
        staticAccountIds,
        btcAmount: btcAmountForUsdDebit,
        usdAmount: debitAmount,
      })
    }

    const creditAmount = btcAmountForUsdDebit ? applyFee(btcAmountForUsdDebit) : debitAmount
    entry.credit(accountId, Number(creditAmount.amount), {
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

const EntryBuilderCreditWithBtcDebit = <M extends MediciEntry>({
  entry,
  metadata,
  applyFee,
  debitAmount,
  staticAccountIds,
}: EntryBuilderCreditState<M, "BTC">): EntryBuilderCreditWithBtcDebit<M> => {
  const creditLnd = () => {
    const creditAmount = applyFee(debitAmount)
    entry.credit(lndLedgerAccountId, Number(creditAmount.amount), {
      ...metadata,
      currency: creditAmount.currency,
    })
    return entry
  }

  const creditColdStorage = () => {
    const creditAmount = applyFee(debitAmount)
    entry.credit(coldStorageAccountId, Number(creditAmount.amount), {
      ...metadata,
      currency: creditAmount.currency,
    })
    return entry
  }

  const creditAccount = ({
    accountId,
    usdAmountForBtcDebit,
  }: {
    accountId: LedgerAccountId
    usdAmountForBtcDebit?: UsdPaymentAmount
  }) => {
    if (usdAmountForBtcDebit) {
      addUsdToDealer({
        entry,
        metadata,
        staticAccountIds,
        btcAmount: debitAmount,
        usdAmount: usdAmountForBtcDebit,
      })
    }
    const creditAmount = usdAmountForBtcDebit || applyFee(debitAmount)
    entry.credit(accountId, Number(creditAmount.amount), {
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
