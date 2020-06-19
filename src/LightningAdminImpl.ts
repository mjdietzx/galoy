import { book } from "medici";
import { LightningMixin } from "./Lightning";
import { LightningUserWallet } from "./LightningUserWallet";
import { getAuth } from "./utils";
import { AdminWallet } from "./wallet";
import { assert } from "console";
const lnService = require('ln-service')
const mongoose = require("mongoose");

export class LightningAdminWallet extends LightningMixin(AdminWallet) {
  constructor({uid}: {uid: string}) {
    super({uid})
  }

  async updateUsersPendingPayment() {
    const User = mongoose.model("User")
    let userWallet

    for await (const user of User.find({}, { _id: 1})) {
      console.log(user)
      // TODO there is no reason to fetch the Auth wallet here.
      // Admin should have it's own auth that it's passing to LightningUserWallet

      // A better approach would be to just loop over pending: true invoice/payment
      userWallet = new LightningUserWallet({uid: user._id})
      await userWallet.updatePending()
    }
  }

  async getBalanceSheet() {
    const MainBook =  new book("MainBook")
    const accounts = await MainBook.listAccounts()
    
    // used for debugging
    for (const account of accounts) {
      const { balance } = await MainBook.balance({
        account: "Assets",
        currency: this.currency
      })
      console.log(account + ": " + balance)
    }

    const assets = (await MainBook.balance({
      account: "Assets",
      currency: this.currency
    })).balance

    const liabilities = (await MainBook.balance({
      account: "Liabilities",
      currency: this.currency
    })).balance

    const lightning = (await MainBook.balance({
      account: "Assets:Reserve:Lightning",
      currency: this.currency
    })).balance

    const shareholder = (await MainBook.balance({
      account: "Liabilities:Shareholder",
      currency: this.currency
    })).balance

    const customers = (await MainBook.balance({
      account: "Liabilities:Customer",
      currency: this.currency
    })).balance

    console.log({assets, liabilities, lightning, shareholder, customers})
    return {assets, liabilities, lightning, shareholder, customers}
  }

  async balanceSheetIsBalanced() {
    const {assets, liabilities, lightning} = await this.getBalanceSheet()
    const lndBalance = this.totalLndBalance()

    assert (assets === - liabilities)
    assert (lightning === lndBalance)
  }

  async totalLndBalance () {
    const auth = getAuth() // FIXME
    const lnd = lnService.authenticatedLndGrpc(auth).lnd // FIXME

    const chainBalance = (await lnService.getChainBalance({lnd})).chain_balance
    const balanceInChannels = (await lnService.getChannelBalance({lnd})).channel_balance;

    return chainBalance + balanceInChannels
  }

  async getInfo() {
    return await lnService.getWalletInfo({ lnd: this.lnd });
  }
}
