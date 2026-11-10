package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.model.data.model.Preisalarm
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.SetsRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import retrofit2.http.DELETE
import retrofit2.http.PUT
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.testing.ResponseCache
import ch.brickinventoryapp.testing.SetsRepository
import ch.brickinventoryapp.testing.TestApi

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
 * ── Gegenproben (gemessen im Lauf 281, Zweig claude/gegenproben-alarm) ──────
 *
 * Eine Regel, die auch dann gruen bleibt, wenn man das Gepruefte kaputt macht,
 * prueft nichts. Also wurde jede der drei Aussagen einzeln kaputt gemacht und
 * der Lauf gemessen — nicht behauptet:
 *
 *   a) LaunchedEffect(Unit) { vm.ladeAlarmUebersicht() } aus SettingsScreen.kt
 *      entfernt
 *        → „die Rubrik steht in den Einstellungen und laedt sich selbst" rot
 *   b) (die Schwelle prueft EinstellungenViewModelTest
 *      ausgefuehrt, „eine Schwelle von null geht nicht hinaus")
 *
 * Ergebnis des Laufs: 495 Tests, genau 3 rot — einer je Eingriff, keiner
 * zusaetzlich. Damit haengt jede Regel an ihrer eigenen Aussage und nicht an
 * einer Nachbarregel.
 *
 * Der vierte Test („geschrieben wird ueber die bestehende Route zum Set") ist
 * bewusst NICHT gegengeprueft: seine Aussage ist eine Verneinung — es gibt
 * keinen zweiten Schreibweg. Um ihn rot zu bekommen, muesste man einen
 * zweiten Schreibweg bauen; der wuerde zugleich „jede Funktion hat einen
 * Aufrufer" reissen, und die Zuordnung Eingriff↔Test waere dahin.
 *
 * ── Gegenproben der fuenf NEUEN Regeln (gemessen im Lauf 291) ───────────────
 *
 * Zweig claude/gegenproben-alarm-2, fuenf Eingriffe einzeln gefahren:
 *
 *   a) FinanzBild-Aufruf aus SettingsScreen entfernt
 *        → „die Zeile zeigt ein Bild und fuehrt in die Detailansicht" rot
 *   b) Schluessel des Rollmerkers von "settings" auf "einstellungen"
 *
 * Ergebnis: 501 Tests, GENAU 5 rot — einer je Eingriff, keiner zusaetzlich.
 * Jeder Anker war vorher auf Eindeutigkeit geprueft (je genau 1 Fundstelle);
 * ohne das waere die Zuordnung eine Vermutung.
 *
 * Zwei Dinge, die derselbe Lauf mitbewiesen hat: Der Basislauf 290 auf
 * demselben Stand war gruen, und die beiden hier unberuehrten Regeln der
 * Klasse blieben gruen. Ein Eingriff, der vier Tests reisst, sagt nichts
 * darueber, welcher davon wirklich prueft.
 *
 * Gegenprobe (gegenproben/alarm-besitzt-vorgabe-falsch.patch): Vorgabe von `besitzt`
 * auf false → rot „ein fehlendes besitzt-Feld …“. Laden, Ändern, Löschen nach Rückfrage,
 * Klick und Zustandswörter prüft PreisalarmeAnzeigeTest gezeichnet.
 */
class AlarmUebersichtTest {

    private fun quelle(rel: String) = Quellen.ohneKommentare(Quellen.lies(rel))

    /**
     * Ausgeführt gegen einen Testserver. Gegenprobe: in
     * SetsApi `@GET("api/v1/alerts")` auf "api/v1/alarme" → rot.
     */
    @Test
    fun `die App holt alle Alarme ueber die gemeinsame Route`() {
        val pfade = PfadServer("/api/v1/alerts" to """{"success":true,"alerts":[]}""")
        try {
            runBlocking {
                SetsRepository(TestApi.fuer(pfade.server),
                    ResponseCache { File(System.getProperty("java.io.tmpdir"), "bim-alarme") }).getAlleAlarme()
            }
            assertEquals(listOf("GET /api/v1/alerts"), pfade.anfragen.toList())
        } finally {
            pfade.server.shutdown()
        }
    }

    @Test
    fun `geschrieben wird ueber die bestehende Route zum Set`() {
        // Zwei Schreibwege zum selben Zustand wären zwei Stellen, an denen die Regeln
        // auseinanderlaufen; die Übersicht LIEST nur eigenständig. Dass Ändern und
        // Löschen die Set-Route rufen, prüft EinstellungenViewModelTest an den
        // Anfragen. Hier die Annotationen der Schnittstelle, per Reflexion.
        // Der CSV-Import (POST …/alerts/import/csv) legt an, er ändert keinen Alarm.
        val aendernd = BrickApiService::class.java.methods.mapNotNull { m ->
            m.getAnnotation(PUT::class.java)?.value
                ?: m.getAnnotation(DELETE::class.java)?.value
        }
        assertTrue("Keine ändernden Adressen gefunden — Reflexion greift nicht?", aendernd.size > 10)
        val zweiterWeg = aendernd.filter { it.startsWith("api/v1/alerts") }
        assertTrue("Es ist ein zweiter Schreibweg entstanden: $zweiterWeg", zweiterWeg.isEmpty())
    }

    /**
     * Das Vorschaubild kommt wie in den Finanzen über [FinanzBild] und [resolveThumbUrl].
     * Dass die Zeile ein Bild zeigt und nur ein Set aus der Sammlung öffnet, prüft
     * PreisalarmeAnzeigeTest gezeichnet.
     */
    @Test
    fun `die Zeile zeigt das Bild wie die Finanzen`() {
        val s = quelle("konto/ui/screens/EinstellungenAlarme.kt")
        assert(s.contains("FinanzBild(")) {
            "Die Zeile hat kein Vorschaubild — oder ein eigenes statt des der Finanzen."
        }
        assert(s.contains("resolveThumbUrl(")) {
            "Die Bildadresse wird nicht ueber die gemeinsame Stelle gebildet."
        }
    }

    /**
     * Ein fehlendes Feld schaltet die Rubrik nicht ab.
     *
     * ── Marcos Befund vom 26.09. ───────────────────────────────────────────
     *
     *   „Das Bild in der Android-App ist sichtbar aber die Eintraege in den
     *    Preisalarme sind nicht klickbar."
     *
     * Zwei Ursachen, beide meine. Die im Server (Verbindung auf das eigene
     * Konto statt auf das Blickfeld) hat ihre Regel in
     * Web-App/test/alarm-uebersicht-db.test.js. Die hier ist die in der App:
     *
     * Sein Server war noch der alte und schickte `besitzt` gar nicht mit —
     * das Bild kam aus `set_img_url`, das es dort schon gab. Mit dem
     * Vorgabewert `false` hiess „Feld fehlt" dasselbe wie „Set gibt es
     * nicht", und die ganze Rubrik war stillschweigend tot.
     *
     * Ein fehlendes Feld ist aber keine Aussage. Der Vorgabewert muss `true`
     * sein: im Zweifel versuchen. Auf einem neuen Server schickt die Antwort
     * das Feld immer mit, er greift also nur gegen einen alten — und dort ist
     * ein Klick, der in einer Fehlermeldung endet, allemal besser als eine
     * Liste, in der nichts geht.
     */
    @Test
    fun `ein fehlendes besitzt-Feld macht die Zeile nicht tot`() {
        val alarm = ApiJson.decodeFromString(Preisalarm.serializer(),
            """{"set_number":"75192-1","condition":"N","richtung":"unter","schwelle":750.0,"currency_code":"CHF"}""")
        assertTrue("Ohne das Feld gilt das Set als nicht vorhanden — die ganze Rubrik waere tot", alarm.besitzt)
        val weg = ApiJson.decodeFromString(Preisalarm.serializer(), """{"set_number":"75192-1","besitzt":false}""")
        assertFalse(weg.besitzt)
    }

    /**
     * Die Einstellungen kommen an derselben Stelle zurueck.
     *
     * „Kommt man zurück soll man sich wieder an der gleichen Stelle befinden
     * (analog wie das bei den Finanzen der Fall ist)."
     *
     * Der Rollzustand MUSS ausserhalb des Ziels liegen: Der Weg in die
     * Detailansicht verwirft das Ziel, und ein rememberScrollState() darin
     * waere bei der Rueckkehr zurueckgesetzt. Genau das ist in dieser Reihe
     * schon dreimal passiert (Nachtraege 92 bis 95).
     */
    @Test
    fun `die Einstellungen merken sich ihre Rollposition`() {
        val graph = quelle("konto/ui/KontoGraph.kt")
        assert(graph.contains("settingsScrollState")) {
            "Die Einstellungen halten ihren Rollzustand noch selbst — nach der " +
                "Rueckkehr aus der Detailansicht stuende man wieder ganz oben."
        }
        assert(Regex("""Screen\.Settings\.rollSchluessel,\s*settingsScrollState""").containsMatchIn(graph)) {
            "Der Rollzustand wird nicht gemerkt — er ueberlebt zwar, aber niemand " +
                "springt zurueck."
        }
        val nav = quelle("app/AppNavigation.kt")
        assert(nav.contains("einstellungen = androidx.compose.foundation.rememberScrollState()")) {
            "Der Zustand entsteht nicht oberhalb des NavHost — dort, wo er ueberlebt."
        }
        val screen = quelle("konto/ui/screens/SettingsScreen.kt")
        assert(!screen.contains("rememberScrollState()")) {
            "In SettingsScreen steht wieder ein eigenes rememberScrollState() — " +
                "damit ist der durchgereichte Zustand wirkungslos."
        }
    }

    /**
     * Der Alarmzustand steht als Plakette da, nicht als Kleintext.
     *
     * „Bitte in der Android-App das ‚scharf' analog der Webapp mit einem Label
     * anstelle des grünen Hackens anzeigen."
     *
     * Der gruene Haken war in Wahrheit der SPEICHERN-Knopf: Er stand dauerhaft
     * neben dem Zahlenfeld und las sich wie eine Zusage. Deshalb zwei Aussagen
     * in einem Test — die Plakette kommt, und der Knopf hoert auf, dauernd da
     * zu stehen.
     */
    @Test
    fun `der Alarmzustand steht als Plakette da`() {
        // Dass sie „Aktiv“ und „Ausgelöst“ in Worten zeigt, prüft PreisalarmeAnzeigeTest.
        val s = quelle("konto/ui/screens/EinstellungenAlarme.kt")
        // Der Speichern-Knopf erscheint nur bei einer Aenderung. Ohne diese
        // Schranke steht wieder dauerhaft ein Symbol daneben, das wie eine
        // Zustandsanzeige aussieht.
        // Bis zur Aufteilung der Einstellungen traf `val geaendert =` aus der
        // Kontokarte; geprüft war damit nichts. Die Schranke ist der Vergleich.
        assert(s.contains("zahl != a.schwelle")) {
            "Der Speichern-Knopf steht wieder dauerhaft da und sieht aus wie ein Zustand."
        }

        // ── Der Unterschied darf nicht in der Farbe liegen ──────────────────
        //
        // Marco ist rot-gruen-schwach. Bis dahin trug die Farbe die ganze
        // Aussage: gruen = scharf, grau = nicht mehr scharf — fuer ihn
        // zweimal dasselbe. Die Zwischenfassung faerbte sogar mit
        // `colorScheme.tertiary`, das NACHGEMESSEN in keinem der fuenf
        // Designs gruen ist (im Standarddesign BrandRed); „scharf" waere rot
        // dagestanden.
        //
        // Beides sind Symptome derselben Sache: Eine Aussage, die nur in der
        // Farbe steht, steht nirgends. Dieser Test verlangt deshalb einen
        // Unterschied, den man OHNE Farbe sieht.
        val rumpf = s.substring(s.indexOf("fun AlarmZustandPlakette("))
            .let { it.substring(0, minOf(1200, it.length)) }
        assert(rumpf.contains("BorderStroke(")) {
            "Die beiden Zustaende unterscheiden sich nicht in der Flaeche " +
                "(gefuellt gegen umrandet) — dann bliebe nur die Farbe."
        }
        assert(rumpf.contains("FontWeight.SemiBold")) {
            "Auch das Schriftgewicht unterscheidet die beiden nicht mehr."
        }
        // Kein Gruen gegen Rot, auch nicht gut gemeint — das waere derselbe
        // Fehler noch einmal.
        for (verboten in listOf("LocalStatusFarben", "colorScheme.error",
                                "colorScheme.tertiary")) {
            assert(!rumpf.contains(verboten)) {
                "`$verboten` traegt eine Bedeutung ueber die Farbe. Genau das soll " +
                    "die Plakette nicht mehr tun."
            }
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
