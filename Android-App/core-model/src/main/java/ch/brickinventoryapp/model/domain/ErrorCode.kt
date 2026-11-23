package ch.brickinventoryapp.model.domain

/**
 * The server's error codes the app branches on. An enumeration instead of
 * scattered strings, so that a typo does not compile and
 * tools/contract/contract-kotlin.test.js can check every identifier against components.schemas.ErrorCode.
 */

enum class ErrorCode(val identifier: String) {
    CURRENT_PASSWORD_REQUIRED("current_password_required"),
    CURRENT_PASSWORD_WRONG("current_password_wrong"),
    BARCODE_NO_SET("barcode_not_a_set"),
    BALANCE_SPACING("balance_interval"),
    BALANCE_BOT_GUARD("balance_bot_protection"),
    ONLY_ADMINS("admins_only"),
    PASSKEY_INVALID("passkey_invalid"),
    PASSWORD_SWITCH_NEEDED("password_change_required"),
    PDF_TOO_MANY_PAGES("pdf_too_many_pages"),
    TOKEN_ROTATION_NEEDED("token_rotation_required"),
    TOKEN_INVALID("token_invalid"),
    UPLOAD_RUNNING("upload_running"),
    TOO_MANY_REQUESTS("too_many_requests"),
    TOO_MANY_FAILED_ATTEMPTS("too_many_failed_attempts"),
    TOO_MANY_CONNECTIONS("too_many_connections"),
    SECOND_FACTOR_WRONG("second_factor_wrong"),
    SECOND_FACTOR_NEEDED("second_factor_required"),
    SECOND_FACTOR_REQUIRED("second_factor_mandatory");

    companion object {
        private val afterId = entries.associateBy { it.identifier }

        /** A code the app does not know is null: it then does not branch on it. */
        fun from(identifier: String?): ErrorCode? = identifier?.let { afterId[it] }
    }
}
