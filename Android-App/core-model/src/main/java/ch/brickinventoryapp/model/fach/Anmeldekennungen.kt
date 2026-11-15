package ch.brickinventoryapp.model.fach

// Kennungen, die die Anmeldung dem Server schickt; Fachwerte statt Wire-Typen, damit
// die Bereiche dafür nicht core-vertrag brauchen.

/** Token-Umfang: "app" ohne Verwalterrechte, "voll" mit — immer ausdrücklich gewählt. */
const val TOKEN_SCOPE_APP = "app"
const val TOKEN_SCOPE_VOLL = "voll"

/** Zweck einer Passkey-Abfrage (routes/auth.ts). */
const val PASSKEY_ANMELDEN = "anmelden"
const val PASSKEY_ZWEITER_FAKTOR = "zweiter_faktor"
