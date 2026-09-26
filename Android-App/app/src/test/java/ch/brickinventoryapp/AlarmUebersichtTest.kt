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
        // Nur der Anfang des Aufrufs, nicht die ganze Zeile: Die Rubrik hat
        // inzwischen vier Parameter (Bild, Serveradresse, Klick), und eine
        // Regel, die an der Anzahl haengt, prueft nicht mehr das, was sie
        // sagt — sie geht beim naechsten Parameter kaputt, ohne dass etwas
        // kaputt waere. Genau das ist hier passiert (Lauf 286).
        assert(s.contains("PreisalarmeCard(vm,") || s.contains("PreisalarmeCard(vm)")) {
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

    /**
     * Vorschaubild und Klick in die Detailansicht — Marcos Nachtrag vom 26.09.
     *
     * „Bitte bei den Zeilen jeweils in beiden Apps noch das Thumbnail anzeigen
     * (analog wie bei den Finanzen). Die Zeilen sollen zudem klickbar sein,
     * dass dann der entsprechende Detaildialog geöffnet wird."
     *
     * Geprueft wird ausdruecklich auf [FinanzBild] und [resolveThumbUrl] und
     * nicht bloss auf „irgendein Bild": „analog wie bei den Finanzen" ist die
     * Vorgabe, und ein zweites, anders beschnittenes Bild an derselben Stelle
     * waere genau das, was Marco seit Monaten anmerkt.
     */
    @Test
    fun `die Zeile zeigt ein Bild und fuehrt in die Detailansicht`() {
        val s = quelle("ui/screens/SettingsScreen.kt")
        assert(s.contains("FinanzBild(")) {
            "Die Zeile hat kein Vorschaubild — oder ein eigenes statt des der Finanzen."
        }
        assert(s.contains("resolveThumbUrl(")) {
            "Die Bildadresse wird nicht ueber die gemeinsame Stelle gebildet."
        }
        assert(s.contains("onSetClick(a.setNumber)")) {
            "Die Zeile oeffnet die Detailansicht nicht — genau das hat Marco verlangt."
        }
        // Nur anklickbar, wenn es das Set gibt: Ein Alarm ueberlebt das
        // Entfernen des Sets, und /v1/sets/:nummer gaebe es dann nicht mehr.
        assert(s.contains("a.besitzt")) {
            "Die Zeile ist auch dann anklickbar, wenn das Set nicht (mehr) in der " +
                "Sammlung liegt — der Klick liefe in eine Fehlermeldung."
        }
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
        val graph = quelle("nav/ToolsGraph.kt")
        assert(graph.contains("settingsScrollState")) {
            "Die Einstellungen halten ihren Rollzustand noch selbst — nach der " +
                "Rueckkehr aus der Detailansicht stuende man wieder ganz oben."
        }
        assert(Regex(""""settings",\s*settingsScrollState""").containsMatchIn(graph)) {
            "Der Rollzustand wird nicht gemerkt — er ueberlebt zwar, aber niemand " +
                "springt zurueck."
        }
        val nav = quelle("AppNavigation.kt")
        assert(nav.contains("val settingsScrollState")) {
            "Der Zustand entsteht nicht oberhalb des NavHost — dort, wo er ueberlebt."
        }
        val screen = quelle("ui/screens/SettingsScreen.kt")
        assert(!screen.contains("rememberScrollState()")) {
            "In SettingsScreen steht wieder ein eigenes rememberScrollState() — " +
                "damit ist der durchgereichte Zustand wirkungslos."
        }
    }

    /**
     * Vor dem Loeschen wird gefragt — wie in der Webapp.
     *
     * „Auch in der Android App soll beim Löschen eines Preisalarm noch
     * nachgefragt werden ob der Eintrag wirklich gelöscht werden soll."
     *
     * Die Webapp fragt seit jeher (`confirm` in 05-settings.js). Geprueft wird
     * nicht nur, dass es einen Dialog GIBT, sondern dass der Loeschknopf nicht
     * mehr direkt loescht — sonst stuende der Dialog daneben und der Knopf
     * fuehre weiter an ihm vorbei.
     */
    @Test
    fun `vor dem Loeschen wird gefragt`() {
        val s = quelle("ui/screens/SettingsScreen.kt")
        assert(s.contains("R.string.alerts_confirm_delete")) {
            "Es gibt keine Rueckfrage vor dem Loeschen eines Preisalarms."
        }
        assert(Regex("""IconButton\(onClick\s*=\s*\{\s*fragtLoeschen\s*=""")
                   .containsMatchIn(s)) {
            "Der Loeschknopf fragt nicht, sondern loescht — der Dialog stuende daneben " +
                "und niemand kaeme an ihm vorbei."
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
        val s = quelle("ui/screens/SettingsScreen.kt")
        assert(s.contains("fun AlarmZustandPlakette(")) { "Es gibt keine Plakette." }
        assert(s.contains("AlarmZustandPlakette(a.ausgeloest)")) {
            "Die Plakette wird nicht benutzt — sie steht da und niemand zeigt sie."
        }
        // Der Speichern-Knopf erscheint nur bei einer Aenderung. Ohne diese
        // Schranke steht wieder dauerhaft ein Symbol daneben, das wie eine
        // Zustandsanzeige aussieht.
        assert(s.contains("val geaendert =")) {
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

    /**
     * Das Wort ist ein Paar — „scharf" gegen „unscharf".
     *
     * Vorher stand „scharf" gegen „hat gemeldet": zwei Aussagen ueber
     * verschiedene Dinge. Wer die Farbe nicht lesen kann, musste daraus
     * schliessen, dass das eine das Gegenteil des anderen sei.
     *
     * Geprueft wird in BEIDEN Sprachdateien — genau hier wurde schon einmal
     * eine Seite nachgezogen und die andere vergessen.
     */
    @Test
    fun `die beiden Alarmzustaende sind als Wortpaar erkennbar`() {
        for (datei in listOf("values/strings.xml", "values-de/strings.xml")) {
            val xml = java.io.File("src/main/res/$datei").readText()
            // Kein dreifaches Anfuehrungszeichen und keine Konstante dafuer:
            // Ein einfaches Muster mit maskierten Anfuehrungszeichen reicht,
            // und der erste Entwurf hatte hier tatsaechlich die drei Zeichen
            // IN das Muster geschrieben statt um es herum.
            fun text(name: String) =
                Regex("<string name=\"" + name + "\">(.*?)</string>")
                    .find(xml)?.groupValues?.get(1) ?: ""
            val scharf = text("alerts_armed")
            val unscharf = text("alerts_fired")
            assert(scharf.isNotBlank() && unscharf.isNotBlank()) {
                "Die Zustandstexte fehlen in $datei."
            }
            // Gefuelltes gegen hohles Zeichen — der dritte Unterschied neben
            // Wort und Flaeche.
            assert(scharf.contains("\u25CF")) { "In $datei fehlt das gefuellte Zeichen." }
            assert(unscharf.contains("\u25CB")) { "In $datei fehlt das hohle Zeichen." }
            // Das eine Wort muss im anderen stecken (scharf/unscharf,
            // armed/not armed): Ohne Farbe ist das der einzige Hinweis darauf,
            // dass der eine Zustand das Gegenteil des anderen ist.
            val a = scharf.filter { it.isLetter() }.lowercase()
            val b = unscharf.filter { it.isLetter() }.lowercase()
            assert(a.isNotEmpty() && b.contains(a)) {
                "Die beiden Zustaende in $datei sind kein erkennbares Gegensatzpaar."
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
