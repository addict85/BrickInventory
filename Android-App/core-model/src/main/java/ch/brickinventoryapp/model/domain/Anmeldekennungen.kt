package ch.brickinventoryapp.model.domain

// Kennungen, die die Anmeldung dem Server schickt; Fachwerte statt Wire-Typen, damit
// die Bereiche dafür nicht core-contract brauchen.

/** Token-Umfang: "app" ohne Verwalterrechte, "voll" mit — immer ausdrücklich gewählt. */
const val TOKEN_SCOPE_APP = "app"
const val TOKEN_SCOPE_FULL = "voll"

/** Zweck einer Passkey-Abfrage (routes/auth.ts). */
const val PASSKEY_SIGN_IN = "anmelden"
const val PASSKEY_SECOND_FACTOR = "zweiter_faktor"
