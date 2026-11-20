package ch.brickinventoryapp.ui.components

import ch.brickinventoryapp.model.schritt.Schrittaktion
import ch.brickinventoryapp.model.schritt.Schrittantwort
import ch.brickinventoryapp.model.schritt.Schrittbindung
import java.security.Signature

/**
 * Eine Bestätigung von der Challenge bis zur Freigabe am Server, ohne Android:
 * Erst fragt der Server, dann die Gerätesperre ([entsperren] liefert die vom
 * Keystore freigegebene Signatur), zuletzt prüft der Server die Signatur. Weiter
 * geht es nur, wenn beide Seiten zugestimmt haben.
 */
class Schrittablauf(private val bindung: Schrittbindung, private val freigabe: Schrittfreigabe) {

    sealed interface Ausgang {
        data object Weiter : Ausgang
        /** Die Sperre wurde abgebrochen oder lieferte keine gültige Signatur. */
        data object Abgebrochen : Ausgang
        data class Rejected(val meldung: String?) : Ausgang
    }

    suspend fun confirm(aktion: Schrittaktion, entsperren: suspend () -> Signature?): Ausgang {
        val c = bindung.challenge(aktion)
        val nachricht = when (c) {
            is Schrittantwort.Challenge -> c.nachricht.toByteArray(Charsets.UTF_8)
            is Schrittantwort.Rejected -> return Ausgang.Rejected(c.meldung)
            Schrittantwort.Free -> return Ausgang.Rejected(null)
            // Ohne Bindung am Server bleibt die Prüfung im Gerät: eine frische Nonce.
            Schrittantwort.NotBound -> freigabe.nonce()
        }
        val signature = freigabe.signature(entsperren(), nachricht) ?: return Ausgang.Abgebrochen
        if (c !is Schrittantwort.Challenge) return Ausgang.Weiter
        return when (val f = bindung.freigeben(c.challenge, signature)) {
            Schrittantwort.Free -> Ausgang.Weiter
            is Schrittantwort.Rejected -> Ausgang.Rejected(f.meldung)
            is Schrittantwort.Challenge, Schrittantwort.NotBound -> Ausgang.Rejected(null)
        }
    }
}
