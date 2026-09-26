package ch.brickinventoryapp

import org.junit.Test

/**
 * Die Preisalarm-Uebersicht gibt es in der App genauso wie in der Webapp.
 *
 * ── Marcos Frage und sein Auftrag vom 25.09. ────────────────────────────────
 *
 *   „Wie finde ich alle Preisalarme?"
 *   „Baue die Uebersicht in beiden Apps in den Einstellungen als Rubrik. Ich
 *    moechte dort den Alarm direkt loeschen koennen oder den Wert anpassen
 *    koennen."
 *
 * Bis dahin war ein Alarm nur im Detail SEINES Sets zu sehen — man musste das
 * Set also schon gefunden haben. Wer fuenfzig setzt, hatte keinen Ort, an dem
 * sie zusammen stehen.
 *
 * ── Warum der Test die WEBAPP mitliest ──────────────────────────────────────
 *
 * „In beiden Apps" ist die Aussage, und sie zerfaellt genau dann still, wenn
 * eine Seite spaeter nachgezogen und die andere vergessen wird. Die Webapp
 * hat dafuer ihre eigene Regel (test/webapp-endpunkte.test.js sagt: entweder
 * die App zieht nach, oder es steht ein Grund dabei) — diese hier ist die
 * Gegenrichtung.
 *
 * ── Gegenproben (durchgefuehrt, Ergebnis im Commit) ─────────────────────────
 *   a) PreisalarmeCard aus der Aufrufliste entfernt → „die Rubrik steht…" rot
 *   b) aendereAlarmSchwelle ohne Pruefung auf > 0   → „unsinnige Schwelle…" rot
 *   c) getAlleAlarme aus dem Repository entfernt    → „die App holt…" rot
 */
class AlarmUebersichtTest {

    private fun quelle(rel: String) = Quellen.ohneKommentare(Quellen.lies(rel))

    @Test
    fun `die App holt alle Alarme ueber die gemeinsame Route`() {
        val api = quelle("data/api/BrickApiService.kt")
        assert(api.contains("""@GET("api/v1/alerts")""")) {
            "Die App kennt die Uebersichtsroute nicht — dann bleibt die Rubrik leer."
        }
        val repo = quelle("data/repository/SetsRepository.kt")
        assert(repo.contains("fun getAlleAlarme(")) { "Das Repository reicht sie nicht durch." }
    }

    @Test
    fun `die Rubrik steht in den Einstellungen und laedt sich selbst`() {
        val s = quelle("ui/screens/SettingsScreen.kt")
        assert(s.contains("PreisalarmeCard(vm)")) {
            "Die Rubrik ist nicht in den Einstellungen eingehaengt — sie existiert, " +
                "aber niemand sieht sie."
        }
        assert(s.contains("vm.ladeAlarmUebersicht()")) {
            "Die Rubrik holt ihre Daten nicht — sie bliebe leer."
        }
        // Loeschen und Aendern, beides: Genau das hat Marco verlangt.
        assert(s.contains("vm.loescheAlarm(")) { "Der Alarm laesst sich nicht loeschen." }
        assert(s.contains("vm.aendereAlarmSchwelle(")) { "Der Wert laesst sich nicht anpassen." }
    }

    @Test
    fun `eine unsinnige Schwelle wird nicht stillschweigend geschrieben`() {
        // Wie in der Webapp: Wer 0 eingibt, soll es sehen, statt spaeter einen
        // Alarm zu suchen, den es nicht gibt.
        val f = quelle("ui/SettingsFeature.kt")
        val i = f.indexOf("fun MainViewModel.aendereAlarmSchwelle(")
        assert(i > 0) { "aendereAlarmSchwelle fehlt — Muster veraltet?" }
        val rumpf = f.substring(i, minOf(i + 700, f.length))
        assert(Regex("""schwelle\s*<=\s*0""").containsMatchIn(rumpf)) {
            "Eine Schwelle von 0 oder weniger geht ungeprueft an den Server."
        }
    }

    @Test
    fun `geschrieben wird ueber die bestehende Route zum Set`() {
        // Zwei Schreibwege zum selben Zustand waeren zwei Stellen, an denen die
        // Regeln auseinanderlaufen. Die Uebersicht LIEST nur eigenstaendig.
        val f = quelle("ui/SettingsFeature.kt")
        assert(f.contains("repo.sets.setPreisalarm(")) { "Aendern geht nicht ueber die Set-Route." }
        assert(f.contains("repo.sets.deletePreisalarm(")) { "Loeschen geht nicht ueber die Set-Route." }
        val api = quelle("data/api/BrickApiService.kt")
        assert(!api.contains("""@PUT("api/v1/alerts""")) {
            "Es ist ein zweiter Schreibweg entstanden — einer davon laeuft irgendwann weg."
        }
    }

    // Die Gegenrichtung — „hat die WEBAPP die Rubrik auch?" — steht bewusst
    // NICHT hier. Sie hat dort ihre eigene Regel: Web-App/test/
    // webapp-endpunkte.test.js verlangt, dass eine Adresse, die nur die Webapp
    // ruft, entweder von der App nachgezogen wird oder einen Grund bei sich
    // traegt. Genau diese Regel hat den Bau dieser Rubrik ausgeloest.
    //
    // Ein zweiter Test dafuer hier haette einen Pfad ueber die Baumgrenze
    // gebraucht, den es in diesem Testbaum nirgends gibt — der erste Entwurf
    // erfand sich dafuer einen Helfer, den es nicht gab.
}
