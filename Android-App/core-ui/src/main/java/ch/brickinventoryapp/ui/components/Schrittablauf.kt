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
        data class Abgelehnt(val meldung: String?) : Ausgang
    }

    suspend fun bestaetige(aktion: Schrittaktion, entsperren: suspend () -> Signature?): Ausgang {
        val c = bindung.challenge(aktion)
        val nachricht = when (c) {
            is Schrittantwort.Challenge -> c.nachricht.toByteArray(Charsets.UTF_8)
            is Schrittantwort.Abgelehnt -> return Ausgang.Abgelehnt(c.meldung)
            Schrittantwort.Frei -> return Ausgang.Abgelehnt(null)
            // Ohne Bindung am Server bleibt die Prüfung im Gerät: eine frische Nonce.
            Schrittantwort.NichtGebunden -> freigabe.nonce()
        }
        val unterschrift = freigabe.unterschrift(entsperren(), nachricht) ?: return Ausgang.Abgebrochen
        if (c !is Schrittantwort.Challenge) return Ausgang.Weiter
        return when (val f = bindung.freigeben(c.challenge, unterschrift)) {
            Schrittantwort.Frei -> Ausgang.Weiter
            is Schrittantwort.Abgelehnt -> Ausgang.Abgelehnt(f.meldung)
            is Schrittantwort.Challenge, Schrittantwort.NichtGebunden -> Ausgang.Abgelehnt(null)
        }
    }
}
