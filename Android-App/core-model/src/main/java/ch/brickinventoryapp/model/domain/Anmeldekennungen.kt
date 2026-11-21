package ch.brickinventoryapp.model.domain

// Identifiers the sign-in sends to the server; domain values instead of wire types, so that
// the areas do not need core-contract for them.

/** Token scope: "app" without admin rights, "voll" with — always chosen explicitly. */
const val TOKEN_SCOPE_APP = "app"
const val TOKEN_SCOPE_FULL = "voll"

/** Zweck einer Passkey-Abfrage (routes/auth.ts). */
const val PASSKEY_SIGN_IN = "anmelden"
const val PASSKEY_SECOND_FACTOR = "zweiter_faktor"
