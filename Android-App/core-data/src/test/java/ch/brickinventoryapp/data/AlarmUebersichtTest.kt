package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.testing.BrickApiService
import ch.brickinventoryapp.vertrag.Preisalarm
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.http.DELETE
import retrofit2.http.PUT
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.testing.AlarmRepository
import ch.brickinventoryapp.testing.TestApi

/**
 * Die Preisalarm-Uebersicht gibt es in der App genauso wie in der Webapp: Ein Alarm,
 * der nur im Detail seines Sets steht, ist nur auffindbar, wenn man das Set schon kennt.
 * Die Webapp prüft die Gegenrichtung (test/abgleich-webapp-endpunkte.test.js).
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
                AlarmRepository(TestApi.fuer(pfade.server)).aktualisiereAlarme()
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
     * Ein fehlendes Feld schaltet die Rubrik nicht ab. Ein älterer Server schickt
     * `besitzt` nicht mit; mit der Vorgabe `false` hiesse „Feld fehlt" dasselbe wie „Set
     * gibt es nicht", und keine Zeile wäre mehr klickbar. Im Zweifel versuchen: Ein Klick,
     * der in einer Fehlermeldung endet, ist besser als eine Liste, in der nichts geht.
     */
    @Test
    fun `ein fehlendes besitzt-Feld macht die Zeile nicht tot`() {
        val alarm = BrickJson.decodeFromString(Preisalarm.serializer(),
            """{"set_number":"75192-1","condition":"N","richtung":"unter","schwelle":750.0,"currency_code":"CHF"}""")
        assertTrue("Ohne das Feld gilt das Set als nicht vorhanden — die ganze Rubrik waere tot", alarm.besitzt)
        val weg = BrickJson.decodeFromString(Preisalarm.serializer(), """{"set_number":"75192-1","besitzt":false}""")
        assertFalse(weg.besitzt)
    }

    /**
     * Die Einstellungen kommen an derselben Stelle zurueck.
     *
     * „Kommt man zurück soll man sich wieder an der gleichen Stelle befinden
     * (analog wie das bei den Finanzen der Fall ist)."
     *
     * Der Weg in die Detailansicht verwirft das Ziel; die Stelle muss darum im
     * ScrollMemory liegen und beim Zurueckkommen ausdruecklich gesetzt werden.
     */
    @Test
    fun `die Einstellungen merken sich ihre Rollposition`() {
        val graph = quelle("konto/ui/KontoGraph.kt")
        assert(graph.contains("settingsScrollState")) {
            "Die Einstellungen halten ihren Rollzustand noch selbst — nach der " +
                "Rueckkehr aus der Detailansicht stuende man wieder ganz oben."
        }
        assert(Regex("""KontoZiel\.Settings\.rollSchluessel,\s*settingsScrollState""").containsMatchIn(graph)) {
            "Der Rollzustand wird nicht gemerkt — er ueberlebt zwar, aber niemand " +
                "springt zurueck."
        }
        // Die Stelle haelt der ScrollMemory, nicht der Zustand: Er entsteht je Besuch neu.
        assert(graph.contains("val settingsScrollState = remember { ScrollState(0) }")) {
            "Die Einstellungen legen ihren Rollzustand nicht im Ziel an"
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
        // Rot-Gruen-Schwaeche ist haeufig; „scharf" gegen „nicht mehr scharf" darf nicht
        // allein an gruen gegen grau haengen.
        //
        // Eine Aussage, die nur in der
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
    // abgleich-webapp-endpunkte.test.js verlangt, dass eine Adresse, die nur die Webapp
    // ruft, entweder von der App nachgezogen wird oder einen Grund bei sich
    // traegt. Genau diese Regel hat den Bau dieser Rubrik ausgeloest.
    //
    // Ein zweiter Test dafuer hier haette einen Pfad ueber die Baumgrenze
    // gebraucht, den es in diesem Testbaum nirgends gibt — der erste Entwurf
    // erfand sich dafuer einen Helfer, den es nicht gab.
}
