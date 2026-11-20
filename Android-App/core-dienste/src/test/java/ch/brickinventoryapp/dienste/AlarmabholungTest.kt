package ch.brickinventoryapp.dienste

import ch.brickinventoryapp.model.fach.asMoney
import ch.brickinventoryapp.model.fach.Geld
import java.time.Instant
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.dienste.alarm.Alarmabholung
import ch.brickinventoryapp.model.fach.AlarmabrufView
import ch.brickinventoryapp.model.fach.PriceAlertView
import ch.brickinventoryapp.data.repository.Ergebnis
import kotlinx.coroutines.test.runTest
import org.junit.Test
import java.util.Locale

/**
 * Was der stuendliche Abruf ENTSCHEIDET.
 *
 * ── Warum es diesen Test gibt ───────────────────────────────────────────────
 *
 * Der Worker selbst laeuft nur mit Android. Die Entscheidungen darin sind aber
 * genau die Sorte, die im Betrieb NICHT auffaellt, wenn sie falsch ist:
 *
 *   * Wird die Marke nicht fortgeschrieben, kommt dieselbe Meldung stuendlich
 *     wieder — und wer sie einmal weggewischt hat, haelt die naechste fuer
 *     eine neue.
 *   * Wird beim ersten Durchgang gemeldet, schlaegt eine frisch eingerichtete
 *     App mit Schwellen auf, die vor Wochen gerissen sind.
 *
 * Alle drei sind Aussagen ueber eine FOLGE von Durchgaengen. Am Quelltext
 * waere nur zu sehen, dass es eine Marke gibt.
 *
 * Deshalb nimmt [Alarmabholung.fetch] die Abfrage als Parameter entgegen und
 * nicht das BrickRepository — die Begruendung steht dort.
 */
class AlarmabholungTest {

    private fun alarm(sn: String = "10179-1", richtung: Alarmrichtung = Alarmrichtung.UNTER,
                      schwelle: Double = 200.0, preis: Double? = 100.0) =
        PriceAlertView(setNumber = sn, condition = Zustand.NEU, richtung = richtung,
                   schwelle = Geld.aus(schwelle)!!, currencyCode = Waehrung("EUR"),
                   ausgeloest = true, lastlyAt = Instant.parse("2026-09-19T17:00:00.000Z"),
                   lastlyPrice = preis.asMoney(), name = null, imageLocal = null, imageUrl = null, setImgUrl = null, besitzt = false)

    private fun antwort(vararg a: PriceAlertView, now: String? = "2026-09-19T18:00:00.000Z") =
        Ergebnis.Erfolg(AlarmabrufView(alerts = a.toList(), marke = now))

    @Test
    fun `der erste Durchgang markiert nur und meldet nichts`() = runTest {
        // Leer und null muessen sich GLEICH verhalten: Auf einem Geraet, das
        // die Marke schon einmal geschrieben hat, kann sie leer sein.
        for (ohne in listOf(null, "", "   ")) {
            var askedWith: String? = "nicht gefragt"
            val e = Alarmabholung.fetch(ohne) { seit ->
                askedWith = seit
                antwort(alarm())
            }
            assert(e is Alarmabholung.Ergebnis.Markiert) {
                "marke=${ohne?.let { "\"$it\"" }}: $e statt Markiert — eine frisch " +
                    "eingerichtete App wuerde mit alten Schwellen aufschlagen"
            }
            assert((e as Alarmabholung.Ergebnis.Markiert).neueMarke == "2026-09-19T18:00:00.000Z")
            assert(askedWith == null) {
                "Eine leere Marke wurde als `since` mitgeschickt: $askedWith"
            }
        }
    }

    @Test
    fun `ein weiterer Durchgang meldet und schreibt die Marke fort`() = runTest {
        var askedWith: String? = null
        val e = Alarmabholung.fetch("2026-09-19T17:30:00.000Z") { seit ->
            askedWith = seit
            antwort(alarm(), alarm(sn = "75192-1"))
        }
        assert(e is Alarmabholung.Ergebnis.Geholt) { "$e statt Geholt" }
        e as Alarmabholung.Ergebnis.Geholt
        assert(e.meldungen.size == 2) { "${e.meldungen.size} Meldungen statt zwei" }
        // Die neue Marke ist die des SERVERS, nicht die mitgegebene und nicht
        // die Uhr des Telefons. Sonst entscheidet die Gangabweichung darueber,
        // ob eine Meldung doppelt kommt oder ausfaellt.
        assert(e.neueMarke == "2026-09-19T18:00:00.000Z") { "neueMarke=${e.neueMarke}" }
        assert(askedWith == "2026-09-19T17:30:00.000Z") { "gefragt mit $askedWith" }
    }

    @Test
    fun `eine leere Antwort ist der Normalfall und schreibt die Marke trotzdem fort`() = runTest {
        // Ohne das fragte der naechste Durchgang wieder ab dem alten Zeitpunkt
        // — und die Spanne wuechse mit jeder ruhigen Stunde.
        val e = Alarmabholung.fetch("2026-09-19T17:30:00.000Z") { antwort() }
        assert(e is Alarmabholung.Ergebnis.Geholt) { "$e statt Geholt" }
        e as Alarmabholung.Ergebnis.Geholt
        assert(e.meldungen.isEmpty())
        assert(e.neueMarke == "2026-09-19T18:00:00.000Z")
    }

    @Test
    fun `ohne brauchbare Antwort bleibt die Marke, wie sie war`() = runTest {
        val kaputt = listOf<Pair<String, Ergebnis<AlarmabrufView>>>(
            "Netz weg" to Ergebnis.Fehler.Netz("offline"),
            "Server sagt nein" to Ergebnis.Fehler.Absage(),
            // Eine aeltere Serverfassung kennt das Feld nicht. Dann lieber gar
            // keine Marke als eine falsche — es bleibt beim Mailversand.
            "kein Zeitpunkt" to Ergebnis.Erfolg(AlarmabrufView(emptyList(), marke = null)),
            "leerer Zeitpunkt" to Ergebnis.Erfolg(AlarmabrufView(emptyList(), marke = "")),
        )
        for ((warum, r) in kaputt) {
            val e = Alarmabholung.fetch("2026-09-19T17:30:00.000Z") { r }
            assert(e is Alarmabholung.Ergebnis.Fehlgeschlagen) {
                "$warum: $e statt Fehlgeschlagen — die Meldung waere verloren"
            }
        }
    }

    @Test
    fun `der Text nennt Set, Preis und Schwelle — in der Waehrung des Alarms`() {
        // Nicht in der aktuellen Kontowaehrung: Die Schwelle wurde in jener
        // Waehrung gesetzt, und 200 CHF sind nicht 200 EUR.
        assert(Alarmabholung.text(alarm(), "faellt unter", "steigt ueber", DE_CH) ==
            "10179-1: EUR\u00a0100.00 (faellt unter EUR\u00a0200.00)")
        assert(Alarmabholung.text(alarm(richtung = Alarmrichtung.UEBER, schwelle = 300.0, preis = 350.5),
                                  "faellt unter", "steigt ueber", DE_CH) ==
            "10179-1: EUR\u00a0350.50 (steigt ueber EUR\u00a0300.00)")
        // Ohne bekannten Preis bleibt die Aussage die Schwelle — ein
        // erfundener Preis waere schlimmer als keiner.
        assert(Alarmabholung.text(alarm(preis = null), "faellt unter", "steigt ueber", DE_CH) ==
            "10179-1: faellt unter EUR\u00a0200.00")
    }

    /**
     * Gegenprobe: gegenproben/alarm-betrag-fest-us.patch (wieder `Locale.US`) → rot
     * „die Betraege stehen in der Zahlenform der App-Sprache“.
     */
    @Test
    fun `die Betraege stehen in der Zahlenform der App-Sprache`() {
        val text = Alarmabholung.text(alarm(schwelle = 1200.0, preis = 999.5), "faellt unter", "steigt ueber",
            Locale.forLanguageTag("de-DE"))
        assert(text == "10179-1: 999,50\u00a0€ (faellt unter 1.200,00\u00a0€)") { text }
    }

    private companion object {
        val DE_CH: Locale = Locale.forLanguageTag("de-CH")
    }
}
