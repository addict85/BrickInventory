package ch.brickinventoryapp.login.ui

import ch.brickinventoryapp.model.text.Message
import ch.brickinventoryapp.uistate.Operation

/**
 * Which of the three forms the sign-in screen shows — the same as in the
 * web app (`showPanel`).
 */
enum class LoginForm { LOGIN, REGISTER, FORGOT_PASSWORD }

/**
 * Sign in, create an account and "forgot password" — a state of its own, because only the
 * sign-in screen reads it. Whether one is signed in (`isLoggedIn`) stays in
 * AppUiState: that decides whether the app shows anything at all.
 */
internal data class LoginUiState(
    /**
     * Which form is open — like `showPanel` in the web app. No navigation
     * entry of its own: otherwise the device's back button would mean something different
     * than "back to sign-in".
     */
    val form: LoginForm = LoginForm.LOGIN,
    /**
     * Is registration open at all? `null` = not asked yet; with `null` and with
     * `false` the link is missing — a button that fails on a 403 is worse
     * than none at all.
     */
    val registrationOpen: Boolean? = null,
    /**
     * The answer to registering or "forgot password" — the server's sentence.
     * It deliberately always answers the same way, so that nobody learns who has an account;
     * a dedicated success message would give it away.
     */
    val message: Message? = null,
    /** An addition to the message, for example that the server does not send email. */
    val hint: Message? = null,
    /** Register or "forgot password". */
    val account: Operation = Operation.Done,
    /** The server demands the second-factor code on sign-in. */
    val codeNeeded: Boolean = false,
    /** It also accepts a passkey instead of the code (`passkey: true` in the answer). */
    val passkeyInsteadOfCode: Boolean = false,
    /**
     * Sign in with admin rights (token scope "voll"). Off until one
     * checks it: a phone is lost more easily than a computer, and
     * administration is rarely needed there.
     */
    val fullAccess: Boolean = false,
    /**
     * The sign-in itself. Its error stays up while the password
     * is being corrected; transient messages go into the message channel.
     */
    val login: Operation = Operation.Done,
    /** The code one types into the browser after a QR scan; null without a running pairing. */
    val qrConfirmation: String? = null,
    /** After the confirmation in the browser: which account on which server; the token only after the yes. */
    val qrAccount: QrAccount? = null,
)

/** What the app shows before taking over a QR access: a planted code would otherwise silently sign in to a foreign account. */
internal data class QrAccount(val user: String, val server: String)
