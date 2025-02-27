import { ValidationError, DomainError, ErrorLevel } from "./shared"

export class InconsistentDataError extends DomainError {}

export class AuthorizationError extends DomainError {}

export class RepositoryError extends DomainError {}
export class UnknownRepositoryError extends RepositoryError {
  level = ErrorLevel.Critical
}
export class PersistError extends RepositoryError {}
export class DuplicateError extends RepositoryError {}

export class CouldNotFindError extends RepositoryError {}

export class CouldNotFindWalletInvoiceError extends CouldNotFindError {}

export class CouldNotFindUserError extends CouldNotFindError {}
export class CouldNotFindUserFromIdError extends CouldNotFindError {}
export class CouldNotFindUserFromKratosIdError extends CouldNotFindError {}
export class CouldNotFindUserFromPhoneError extends CouldNotFindError {}
export class CouldNotFindUserFromWalletIdError extends CouldNotFindError {}
export class CouldNotFindPhoneCodeError extends CouldNotFindError {}
export class CouldNotFindWalletFromIdError extends CouldNotFindError {}
export class CouldNotListWalletsFromAccountIdError extends CouldNotFindError {}
export class CouldNotFindWalletFromUsernameError extends CouldNotFindError {}
export class CouldNotFindWalletFromUsernameAndCurrencyError extends CouldNotFindError {}
export class CouldNotFindWalletFromOnChainAddressError extends CouldNotFindError {}
export class CouldNotFindWalletFromOnChainAddressesError extends CouldNotFindError {}
export class CouldNotFindLnPaymentFromHashError extends CouldNotFindError {}
export class NoTransactionToUpdateError extends CouldNotFindError {}

export class CouldNotFindAccountFromUsernameError extends CouldNotFindError {}
export class CouldNotFindAccountFromPhoneError extends CouldNotFindError {}

export class RewardAlreadyPresentError extends DomainError {}

export class NotImplementedError extends DomainError {}
export class NotReachableError extends DomainError {}
export class InvalidNegativeAmountError extends DomainError {}
export class MissingPhoneError extends DomainError {}

export class ContactNotExistentError extends DomainError {}
export class InvalidWithdrawFeeError extends ValidationError {}
export class InvalidCurrencyBaseAmountError extends ValidationError {}
export class InvalidSatoshiAmountError extends ValidationError {}
export class InvalidUsdCents extends ValidationError {}
export class NonIntegerError extends ValidationError {}
export class InvalidOnChainAddress extends ValidationError {}
export class InvalidScanDepthAmount extends ValidationError {}
export class SatoshiAmountRequiredError extends ValidationError {}
export class InvalidUsername extends ValidationError {}
export class InvalidContactAlias extends ValidationError {}
export class InvalidCoordinatesError extends ValidationError {}
export class InvalidBusinessTitleLengthError extends ValidationError {}
export class InvalidAccountStatusError extends ValidationError {}
export class InvalidPhoneNumber extends ValidationError {}
export class InvalidKratosUserId extends ValidationError {}
export class InvalidEmailAddress extends ValidationError {}
export class InvalidWalletId extends ValidationError {}
export class InvalidLedgerTransactionId extends ValidationError {}
export class AlreadyPaidError extends ValidationError {}
export class SelfPaymentError extends ValidationError {}
export class LessThanDustThresholdError extends ValidationError {}
export class InsufficientBalanceError extends ValidationError {}
export class BalanceLessThanZeroError extends ValidationError {}
export class InvalidTargetConfirmations extends ValidationError {}
export class NoContactForUsernameError extends ValidationError {}
export class LnPaymentRequestNonZeroAmountRequiredError extends ValidationError {}
export class LnPaymentRequestZeroAmountRequiredError extends ValidationError {}
export class NoWalletExistsForUserError extends ValidationError {}
export class RebalanceNeededError extends ValidationError {}
export class InvalidQuizQuestionIdError extends ValidationError {}
export class MissingPhoneMetadataError extends ValidationError {}
export class InvalidPhoneMetadataTypeError extends ValidationError {}
export class InvalidPhoneMetadataForRewardError extends ValidationError {}
export class InvalidLanguageError extends ValidationError {}
export class InvalidAccountLevelError extends ValidationError {}

export class LimitsExceededError extends ValidationError {}
export class WithdrawalLimitsExceededError extends LimitsExceededError {}
export class IntraledgerLimitsExceededError extends LimitsExceededError {}
export class TwoFALimitsExceededError extends LimitsExceededError {}

export class LnRouteValidationError extends ValidationError {}
export class BadAmountForRouteError extends LnRouteValidationError {}
