package ch.brickinventoryapp.model.step

/** [kennung] is the server's action; without it the check stays on the device (before sign-in). */

enum class Schrittaktion(val kennung: String?) {
    GUTSCHEIN("gutschein"),
    VERWALTUNG("verwaltung"),
    ZWEITER_FAKTOR("zweiter_faktor"),
    LOKAL(null),
}

/** What the server says about a step; [Rejected.meldung] null means: no response. */
sealed interface Schrittantwort {
    data class Challenge(val challenge: String, val nachricht: String) : Schrittantwort
    data object Free : Schrittantwort
    /** A step without action at the server ([Schrittaktion.LOKAL]): the check stays on the device. */
    data object NotBound : Schrittantwort
    data class Rejected(val meldung: String?) : Schrittantwort
}

/** The nonce the keystore key carries as attestation challenge ([Nonce.wert]: Base64url). */
sealed interface Schluesselnonce {
    data class Nonce(val wert: String) : Schluesselnonce
    data class Rejected(val meldung: String?) : Schluesselnonce
}

/** The path to the server; core-data implements it, core-ui asks it before every step. */
interface Schrittbindung {
    /** [Schrittantwort.Challenge], [Schrittantwort.NotBound] or [Schrittantwort.Rejected]. */
    suspend fun challenge(aktion: Schrittaktion): Schrittantwort
    /** [Schrittantwort.Free] or [Schrittantwort.Rejected]. */
    suspend fun freigeben(challenge: String, signatur: ByteArray): Schrittantwort
    /**
     * Only right after sign-in. There is no path without nonce: the server accepts
     * no bare key, a fallback to it could only be forced.
     */
    suspend fun schluesselNonce(): Schluesselnonce = Schluesselnonce.Rejected(null)

    /** The attestation chain (DER per certificate, leaf first): [Schrittantwort.Free] or [Schrittantwort.Rejected]. */
    suspend fun depositChain(kette: List<ByteArray>): Schrittantwort = Schrittantwort.Rejected(null)

    companion object {
        /** Without server, for tests and activities without account. */
        val OHNE: Schrittbindung = object : Schrittbindung {
            override suspend fun challenge(aktion: Schrittaktion) = Schrittantwort.NotBound
            override suspend fun freigeben(challenge: String, signatur: ByteArray) = Schrittantwort.Free
        }
    }
}
