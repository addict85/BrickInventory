package ch.brickinventoryapp.model.schritt

/** [kennung] ist die Aktion des Servers; ohne sie bleibt die Prüfung im Gerät (vor der Anmeldung). */

enum class Schrittaktion(val kennung: String?) {
    GUTSCHEIN("gutschein"),
    VERWALTUNG("verwaltung"),
    ZWEITER_FAKTOR("zweiter_faktor"),
    LOKAL(null),
}

/** Was der Server zu einem Schritt sagt; [Abgelehnt.meldung] null heisst: keine Antwort. */
sealed interface Schrittantwort {
    data class Challenge(val challenge: String, val nachricht: String) : Schrittantwort
    data object Frei : Schrittantwort
    /** Ein Schritt ohne Aktion am Server ([Schrittaktion.LOKAL]): Die Prüfung bleibt im Gerät. */
    data object NichtGebunden : Schrittantwort
    data class Abgelehnt(val meldung: String?) : Schrittantwort
}

/** Die Nonce, die der Keystore-Schlüssel als Attestation-Challenge trägt ([Nonce.wert]: Base64url). */
sealed interface Schluesselnonce {
    data class Nonce(val wert: String) : Schluesselnonce
    data class Abgelehnt(val meldung: String?) : Schluesselnonce
}

/** Der Weg zum Server; core-data setzt ihn um, core-ui fragt ihn vor jedem Schritt. */
interface Schrittbindung {
    /** [Schrittantwort.Challenge], [Schrittantwort.NichtGebunden] oder [Schrittantwort.Abgelehnt]. */
    suspend fun challenge(aktion: Schrittaktion): Schrittantwort
    /** [Schrittantwort.Frei] oder [Schrittantwort.Abgelehnt]. */
    suspend fun freigeben(challenge: String, signatur: ByteArray): Schrittantwort
    /**
     * Nur gleich nach der Anmeldung. Es gibt keinen Weg ohne Nonce: Der Server nimmt
     * keinen blossen Schlüssel an, ein Rückfall darauf liesse sich nur erzwingen.
     */
    suspend fun schluesselNonce(): Schluesselnonce = Schluesselnonce.Abgelehnt(null)

    /** Die Attestierungskette (DER je Zertifikat, Blatt zuerst): [Schrittantwort.Frei] oder [Schrittantwort.Abgelehnt]. */
    suspend fun hinterlegeKette(kette: List<ByteArray>): Schrittantwort = Schrittantwort.Abgelehnt(null)

    companion object {
        /** Ohne Server, für Tests und Activities ohne Konto. */
        val OHNE: Schrittbindung = object : Schrittbindung {
            override suspend fun challenge(aktion: Schrittaktion) = Schrittantwort.NichtGebunden
            override suspend fun freigeben(challenge: String, signatur: ByteArray) = Schrittantwort.Frei
        }
    }
}
