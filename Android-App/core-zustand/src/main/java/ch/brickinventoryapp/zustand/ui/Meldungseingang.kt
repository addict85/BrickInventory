package ch.brickinventoryapp.zustand.ui

import java.util.concurrent.atomic.AtomicReference
import javax.inject.Inject
import javax.inject.Singleton

/** Setnummern wie „75192-1“ oder „col23-1“; alles andere ist kein Ziel. */
private val SETNUMMER = Regex("^[0-9A-Za-z-]{1,20}$")

/** Die Setnummer, wenn sie dem Format genügt, sonst null. */
fun setnummerAusMeldung(roh: String?): String? = roh?.takeIf { SETNUMMER.matches(it) }

/**
 * Das Ziel einer angetippten Meldung, im Prozess abgelegt. Die exportierte
 * MainActivity liest keine Extras mehr: Nur der nicht exportierte
 * MeldungsEinstieg legt hier ab, und den kann keine fremde App starten.
 */
@Singleton
class Meldungseingang @Inject constructor() {
    private val ziel = AtomicReference<String?>(null)

    /** @return false, wenn [roh] keine Setnummer ist; dann bleibt nichts liegen. */
    fun ablegen(roh: String?): Boolean {
        val sn = setnummerAusMeldung(roh) ?: return false
        ziel.set(sn)
        return true
    }

    /** Einmal abholen: Ein zweiter Start derselben Activity öffnet das Set nicht erneut. */
    fun abholen(): String? = ziel.getAndSet(null)
}
