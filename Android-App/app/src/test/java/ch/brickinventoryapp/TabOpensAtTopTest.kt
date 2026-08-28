package ch.brickinventoryapp

import org.junit.Test

/**
 * Ein angetippter Reiter beginnt oben.
 *
 * ── Marcos Vorgabe (Nachtrag 114) ───────────────────────────────────────────
 * „Im Reiter Teile muss ich beim Öffnen nach oben scrollen, damit die manuell
 * erfassten Teile angezeigt werden. Das Gleiche gilt evtl. auch im Reiter
 * Minifiguren. Wenn der Reiter geöffnet wird, soll die Seite direkt die manuell
 * erfassten Teile bzw. Minifiguren anzeigen."
 *
 * Sein „evtl. auch" traf zu: Beide Raster beginnen mit `key = "manual-header"`
 * und den manuell erfassten Einträgen, danach folgt „Aus Sets".
 *
 * ── Zwei Absichten, die man trennen muss ────────────────────────────────────
 * Der Scroll-Merker (Nachträge 92 bis 95) ist dafür da, dass die Liste beim
 * ZURÜCKKEHREN aus einer Detailansicht wieder an derselben Stelle steht. Er
 * griff bisher auch beim Antippen des Reiters — dann öffnete sich dieser
 * irgendwo in der Mitte.
 *
 * „Ich komme zurück" behält die Stelle. „Ich gehe auf diesen Reiter" fängt oben
 * an. Unterschieden wird das in der unteren Leiste, wo der Unterschied bekannt
 * ist — im Bildschirm selbst ist beides nicht auseinanderzuhalten.
 */
class TabOpensAtTopTest {

    // Gemeinsame Fassung statt einer eigenen Kopie je Testdatei — siehe
    // Quellen.kt (Nachtrag 115).
    private fun lies(rel: String) = Quellen.lies(rel)
    private fun code(src: String) = Quellen.ohneKommentare(src)

    @Test
    fun `das Antippen eines Reiters verwirft dessen Rollposition`() {
        val ms = code(lies("../MainScaffold.kt"))
        assert(ms.contains("onTabAngetippt")) { "Der Rückruf fehlt in MainScaffold" }
        // Er muss VOR der Navigation laufen — danach ist der Bildschirm unter
        // Umständen schon zusammengesetzt und hat die alte Stelle gelesen.
        val ruf = ms.indexOf("onTabAngetippt(screen)")
        val nav = ms.indexOf("navController.navigate(screen.route)")
        assert(ruf in 0 until nav) {
            "onTabAngetippt läuft nicht VOR der Navigation — dann kann der " +
                "Bildschirm die alte Stelle bereits wiederhergestellt haben."
        }
    }

    @Test
    fun `kein Reiter-Ziel baut das Geruest selbst`() {
        // Bis Nachtrag 119 stand hier: "jede MainScaffold-Einbindung reicht den
        // Rueckruf durch" — neunmal dieselben fuenf Zeilen, und dieser Test
        // zaehlte nach, ob keine davon etwas vergessen hatte. Seit Nachtrag 120
        // gibt es ReiterGeruest, das den Rueckruf EINMAL setzt; zu zaehlen gibt
        // es damit nichts mehr. Die Aussage ist jetzt: Kein Ziel geht am
        // Geruest vorbei.
        //
        // ZUR UNTERGRENZE: Hier stand `>= 20` — fuer einen Ordner mit vier
        // Dateien. Der Test waere bei jedem Lauf an seiner eigenen Wache
        // gescheitert. Mein Fehler aus Nachtrag 118: dieselbe Zahl in fuenf
        // Testdateien gesetzt, ohne zu pruefen, worauf sie jeweils zeigt. Eine
        // Untergrenze muss zum Bereich passen, sonst ist sie kein Schutz,
        // sondern ein Ausfall.
        val ziele = Quellen.unter("nav")
        assert(ziele.size >= 3) { "Nur ${ziele.size} Dateien unter nav/ — Pfad veraltet?" }

        val direkt = ziele.filter { code(it.readText()).contains("MainScaffold(") }
        assert(direkt.isEmpty()) {
            "Diese Navigationsdateien bauen MainScaffold selbst statt ReiterGeruest zu " +
                "nutzen: ${direkt.joinToString { it.name }}. Dann muessen sie den Rueckruf, " +
                "das Abmelden und serverUrl/isAdmin wieder von Hand durchreichen — und " +
                "genau dabei ist in Nachtrag 114 einer vergessen worden."
        }

        val geruest = code(lies("../MainScaffold.kt"))
        assert(geruest.contains("fun ReiterGeruest(")) { "ReiterGeruest fehlt" }
        assert(geruest.contains("onTabAngetippt = { ziel -> vm.scrollMemory.vergissReiter(ziel.route) }")) {
            "Das Geruest verwirft die Rollposition nicht mehr — dann beginnt der Reiter " +
                "je nach Herkunft mal oben und mal in der Mitte."
        }
    }

    @Test
    fun `die manuell erfassten Eintraege stehen oben`() {
        // Die Vorgabe lautet „direkt die manuell erfassten anzeigen" — das setzt
        // voraus, dass sie am Anfang der Liste stehen. Kehrt die Reihenfolge
        // sich um, wäre das Verwerfen der Rollposition wirkungslos.
        for (datei in listOf("ui/screens/PartsScreen.kt", "ui/screens/MinifigsScreen.kt")) {
            val c = code(lies(datei))
            val manuell = c.indexOf("\"manual-header\"")
            val ausSets = c.indexOf("\"sets-header\"")
            assert(manuell >= 0) { "$datei: kein Abschnitt für manuell erfasste Einträge" }
            assert(ausSets < 0 || manuell < ausSets) {
                "$datei: „Aus Sets\" steht vor den manuell erfassten Einträgen"
            }
        }
    }
}
