package ch.brickinventoryapp

import org.junit.Test

/**
 * Aufgeteilte Dateien erben die Wildcard-Importe ihrer Quelldatei.
 *
 * ── Marcos Build brach hier ab (Nachtrag 100) ───────────────────────────────
 *
 *     CatalogSections.kt:55:53 Unresolved reference 'ArrowDropDown'.
 *
 * Beim Aufteilen der grossen Bildschirme habe ich die Importe der neuen Dateien
 * geprüft — aber nur gegen die EINZELimporte der Quelldatei. Namen, die dort per
 * `androidx.compose.material.icons.filled.*` gedeckt waren, tauchten in dieser
 * Liste gar nicht auf und konnten deshalb nicht als fehlend gemeldet werden.
 *
 * Die Lehre ist nicht „diesen einen Namen nachtragen", sondern: Eine
 * herausgelöste Datei bekommt die Wildcards ihrer Quelle mit. Sonst muss man
 * Name für Name raten, und genau das geht schief.
 *
 * Diese Prüfung braucht keinen Compiler und läuft in Millisekunden — der
 * Gradle-Lauf, der denselben Fehler findet, dauert Minuten.
 */
class SplitFileImportsTest {

    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Herausgelöste Datei → Datei, aus der sie stammt. */
    private val paare = listOf(
        "ui/screens/SetDetailSections.kt" to "ui/screens/SetDetailScreen.kt",
        "ui/screens/FinanceSections.kt" to "ui/screens/FinanceScreen.kt",
        "ui/screens/CatalogSections.kt" to "ui/screens/CatalogScreen.kt",
        "ui/screens/MonitoringSections.kt" to "ui/screens/MonitoringScreen.kt",
        "ui/screens/BarcodeAnalyzer.kt" to "ui/screens/BarcodeScannerScreen.kt",
        "ui/dialogs/BarcodeResultDialog.kt" to "AppNavigation.kt",
    )

    private fun wildcards(src: String) =
        Regex("""^import [\w.]+\.\*$""", RegexOption.MULTILINE)
            .findAll(src).map { it.value }.toSet()

    @Test
    fun `jede aufgeteilte Datei erbt die Wildcards ihrer Quelle`() {
        for ((neu, orig) in paare) {
            val n = read(neu)
            val fehlend = wildcards(read(orig)) - wildcards(n)
            assert(fehlend.isEmpty()) {
                "$neu fehlen Wildcard-Importe der Quelldatei: ${fehlend.joinToString()}. " +
                    "Ohne sie muss jeder gedeckte Name einzeln erraten werden — daran " +
                    "ist der Build in Nachtrag 100 gescheitert."
            }
        }
    }

    @Test
    fun `jeder Icons-Verweis ist gedeckt`() {
        // Die konkrete Ausprägung des Fehlers. Icons.Default.X braucht
        // `androidx.compose.material.icons.filled.X` oder das Wildcard darüber.
        val stile = mapOf(
            "Default" to "androidx.compose.material.icons.filled.",
            "Filled" to "androidx.compose.material.icons.filled.",
            "Outlined" to "androidx.compose.material.icons.outlined.",
            "Rounded" to "androidx.compose.material.icons.rounded.",
        )
        val wurzel = java.io.File("src/main/java/ch/brickinventoryapp")
        val fehler = mutableListOf<String>()
        // Untergrenze (Nachtrag 118): ein leerer Dateilauf lässt jede
        // Sammelprüfung darunter stillschweigend bestehen.
        check(wurzel.walkTopDown().count { it.extension == "kt" } >= 20) {
            "Zu wenige Kotlin-Dateien unter ${'$'}{wurzel.path} — Pfad veraltet?"
        }
        wurzel.walkTopDown().filter { it.extension == "kt" }.forEach { f ->
            val src = f.readText()
            val importe = Regex("""^import ([\w.*]+)$""", RegexOption.MULTILINE)
                .findAll(src).map { it.groupValues[1] }.toSet()
            val wild = importe.filter { it.endsWith("*") }.map { it.dropLast(1) }.toSet()
            for (m in Regex("""\bIcons\.(AutoMirrored\.)?(\w+)\.(\w+)""").findAll(src)) {
                val (auto, stil, name) = m.destructured
                val basis = if (auto.isNotEmpty())
                    "androidx.compose.material.icons.automirrored.${stil.lowercase()}."
                else stile[stil] ?: continue
                if (basis + name in importe || basis in wild) continue
                fehler += "${f.name}: Icons.$auto$stil.$name"
            }
        }
        assert(fehler.isEmpty()) {
            "Icon-Verweise ohne Import:\n  " + fehler.joinToString("\n  ")
        }
    }

    /**
     * Die Gegenrichtung: ein Name, der NICHT importierbar ist.
     *
     * ── Gemessen am 19.10., in der CI ───────────────────────────────────────
     *
     *     > Task :app:compileDebugKotlin FAILED
     *     Unresolved reference 'ExposedDropdownMenu'.
     *     Location: .../ui/screens/FarbWahlFeld.kt:11
     *
     * `ExposedDropdownMenu` ist in Material 3 kein Composable auf oberster
     * Ebene, sondern ein MITGLIED von `ExposedDropdownMenuBoxScope`. Innerhalb
     * des Box-Rumpfs ist es damit ohnehin da — ein Import darauf zeigt ins
     * Leere, auch wenn er wie die drei Zeilen darueber aussieht
     * (ExposedDropdownMenuBox, -Defaults und -AnchorType sind sehr wohl
     * importierbar). Genau diese Nachbarschaft macht den Fehler leicht.
     *
     * Die beiden bestehenden Nutzer belegen es: LagerortFeld.kt ruft
     * `ExposedDropdownMenu` ohne Import, PartsDialogs.kt unter `material3.*`.
     * Beide uebersetzen.
     *
     * Hier wird in dieser Umgebung nicht uebersetzt (dl.google.com ist
     * gesperrt), die Uebersetzung macht die CI — und das dauert Minuten. Diese
     * Pruefung dauert Millisekunden, dieselbe Begruendung wie beim Fall
     * darueber.
     *
     * Die Liste ist bewusst KURZ: Jeder Eintrag ist ein Name, der einmal
     * wirklich so gescheitert ist. Geraten wird hier nichts.
     */
    @Test
    fun `kein Import auf ein Bereichs-Mitglied`() {
        val nichtImportierbar = mapOf(
            "androidx.compose.material3.ExposedDropdownMenu" to
                "Mitglied von ExposedDropdownMenuBoxScope — im Rumpf der Box ohnehin da",
        )
        val wurzel = java.io.File("src/main/java/ch/brickinventoryapp")
        val dateien = wurzel.walkTopDown().filter { it.extension == "kt" }.toList()
        check(dateien.size >= 20) {
            "Zu wenige Kotlin-Dateien unter ${'$'}{wurzel.path} — Pfad veraltet? Ohne " +
                "Treffer waere diese Pruefung stillschweigend gruen."
        }
        val fehler = mutableListOf<String>()
        for (f in dateien) {
            val importe = Regex("""^import ([\w.]+)${'$'}""", RegexOption.MULTILINE)
                .findAll(f.readText()).map { it.groupValues[1] }.toSet()
            for ((name, grund) in nichtImportierbar) {
                if (name in importe) fehler += "${'$'}{f.name}: import ${'$'}name — ${'$'}grund"
            }
        }
        assert(fehler.isEmpty()) {
            "Importe, die ins Leere zeigen:\n  " + fehler.joinToString("\n  ") +
                "\nDie Zeile ersatzlos streichen — der Name steht im Rumpf schon zur " +
                "Verfuegung. Genau daran ist die CI am 19.10. gescheitert."
        }
    }

    /**
     * Ein deutsches Anfuehrungszeichen, das die Zeichenkette aus Versehen beendet.
     *
     * ── Gemessen am 19.10., in der CI ───────────────────────────────────────
     *
     *     > Task :app:compileDebugUnitTestKotlin FAILED
     *     Unresolved reference 'Verlangt' on receiver of type 'String'.
     *     Location: .../TeilFarbeAendernTest.kt:157
     *
     * Die Zeile lautete:
     *
     *     "… hinter der Bedingung „$bedingung". Verlangt sie " +
     *
     * Das deutsche Paar ist `„ … "`. Wer das schliessende Zeichen als
     * schlichtes `"` tippt, beendet damit die KOTLIN-Zeichenkette, und alles
     * dahinter liest der Uebersetzer als Code — hier `.Verlangt` als
     * Feldzugriff auf einen String. Der Baum schreibt es deshalb ueberall als
     * `\"`; GEMESSEN sind das 14 Stellen, und alle 14 machen es richtig.
     *
     * ── Warum die Regel so eng ist ──────────────────────────────────────────
     *
     * Ein `„` gefolgt von einem unmaskierten `"` ist fuer sich NOCH kein
     * Fehler: Eine Zeichenkette darf dort enden und auf der naechsten Zeile
     * mit `+` weitergehen (so steht es in TokenVorDerSchreibungTest.kt, und
     * das ist richtig). Erst wenn direkt hinter dem `"` ein BUCHSTABE oder ein
     * PUNKT steht, kann es keine Fortsetzung mehr sein.
     *
     * Mit dieser Fassung GEMESSEN: genau ein Treffer im ganzen Baum, naemlich
     * der oben. Die weitere Fassung ohne die letzte Bedingung meldete 2, davon
     * einen gesunden; die ganz weite (ohne Kommentarfilter) 724.
     *
     * ── Auch der TESTbaum, und das ist hier der Punkt ───────────────────────
     *
     * Quellen.alle() liest nur src/main. Der Fehler, um den es geht, stand in
     * einer TESTdatei — eine Pruefung, die nur src/main liest, haette genau
     * ihn nicht gefunden. Beide Baeume werden uebersetzt, also werden beide
     * gelesen.
     */
    @Test
    fun `kein deutsches Anfuehrungszeichen beendet eine Zeichenkette`() {
        val muster = Regex("""\u201e[^"\n]*(?<!\\)"[A-Za-z.]""")
        val dateien = (Quellen.alle() + java.io.File("src/test/java")
            .walkTopDown().filter { it.isFile && it.extension == "kt" }).toList()
        check(dateien.size >= 100) {
            "Nur ${'$'}{dateien.size} Kotlin-Dateien gelesen — Pfad veraltet? Ohne Treffer " +
                "waere diese Pruefung stillschweigend gruen."
        }
        val fehler = dateien.flatMap { f ->
            Quellen.ohneKommentare(f.readText()).lines().withIndex()
                .filter { (_, z) -> muster.containsMatchIn(z) }
                .map { (i, z) -> "${'$'}{f.name}:${'$'}{i + 1}: ${'$'}{z.trim()}" }
        }
        assert(fehler.isEmpty()) {
            "Hier beendet ein schliessendes Anfuehrungszeichen die Zeichenkette:\n  " +
                fehler.joinToString("\n  ") +
                "\nDas schliessende Zeichen des deutschen Paares gehoert als \\\" " +
                "geschrieben. Genau daran ist die CI am 19.10. gescheitert."
        }
    }

    /** Kommentare und Zeichenketten durch Leerzeichen ersetzen, Zeilen erhalten. */
    private fun entkleide(src: String): String {
        val out = StringBuilder()
        var i = 0
        while (i < src.length) {
            when {
                src.startsWith("//", i) -> {
                    val j = src.indexOf('\n', i).let { if (it < 0) src.length else it }
                    repeat(j - i) { out.append(' ') }; i = j
                }
                src.startsWith("/*", i) -> {
                    val j = src.indexOf("*/", i + 2).let { if (it < 0) src.length else it + 2 }
                    for (c in src.substring(i, j)) out.append(if (c == '\n') '\n' else ' '); i = j
                }
                src.startsWith("\"\"\"", i) -> {
                    val j = src.indexOf("\"\"\"", i + 3).let { if (it < 0) src.length else it + 3 }
                    for (c in src.substring(i, j)) out.append(if (c == '\n') '\n' else ' '); i = j
                }
                src[i] == '"' -> {
                    var j = i + 1
                    while (j < src.length && src[j] != '"') j += if (src[j] == '\\') 2 else 1
                    j++
                    for (c in src.substring(i, minOf(j, src.length))) out.append(if (c == '\n') '\n' else ' ')
                    i = j
                }
                else -> { out.append(src[i]); i++ }
            }
        }
        return out.toString()
    }

    @Test
    fun `keine Datei ruft eine private Deklaration einer anderen`() {
        // ── Marcos zweiter Build brach hier ab (Nachtrag 101) ────────────────
        //
        //     CatalogSections.kt:79:36 Cannot access 'fun sortLabel(...)':
        //     it is private in file.
        //
        // `private` gilt in Kotlin DATEIWEIT. Wandert ein Block in eine andere
        // Datei, verliert er den Zugriff auf alle privaten Nachbarn seiner
        // Quelle — ohne dass sich an Namen oder Importen etwas ändert. Keine
        // Import-Prüfung kann das sehen; es ist eine reine Sichtbarkeitsfrage.
        //
        // Die Antwort ist `internal`: sichtbar im Modul, weiterhin nicht Teil
        // einer öffentlichen Schnittstelle.
        val wurzel = java.io.File("src/main/java/ch/brickinventoryapp")
        // Untergrenze (Nachtrag 118): ein leerer Dateilauf lässt jede
        // Sammelprüfung darunter stillschweigend bestehen.
        check(wurzel.walkTopDown().count { it.extension == "kt" } >= 20) {
            "Zu wenige Kotlin-Dateien unter ${'$'}{wurzel.path} — Pfad veraltet?"
        }
        val dateien = wurzel.walkTopDown().filter { it.extension == "kt" }.toList()

        val privat = mutableMapOf<String, MutableList<String>>()
        val deklaration = Regex(
            """^private\s+(?:@\w+\s+)?(?:const\s+)?(?:suspend\s+)?(?:fun|val|var|class|object)\s+(?:<[^>]*>\s*)?(\w+)""",
            RegexOption.MULTILINE)
        for (f in dateien) {
            for (m in deklaration.findAll(entkleide(f.readText()))) {
                privat.getOrPut(m.groupValues[1]) { mutableListOf() }.add(f.name)
            }
        }

        val fehler = mutableListOf<String>()
        for (f in dateien) {
            val roh = f.readText()
            val code = entkleide(roh)
            val eigen = Regex(
                """^(?:private\s+|internal\s+)?(?:@\w+\s+)?(?:const\s+)?(?:suspend\s+)?(?:fun|val|var|class|object)\s+(?:<[^>]*>\s*)?(\w+)""",
                RegexOption.MULTILINE).findAll(code).map { it.groupValues[1] }.toMutableSet()
            eigen += Regex("""\b(?:val|var)\s+(\w+)""").findAll(code).map { it.groupValues[1] }
            eigen += Regex("""^import ([\w.]+)$""", RegexOption.MULTILINE)
                .findAll(roh).map { it.groupValues[1].substringAfterLast('.') }

            for ((name, quellen) in privat) {
                if (name in eigen || f.name in quellen) continue
                if (Regex("""(?<![\w.])$name\s*\(""").containsMatchIn(code)) {
                    fehler += "${f.name}: ruft $name() — private in ${quellen.joinToString()}"
                }
            }
        }
        assert(fehler.isEmpty()) {
            "Zugriff auf private Deklarationen anderer Dateien:\n  " +
                fehler.joinToString("\n  ") +
                "\n(`internal` statt `private` an der Deklaration behebt das.)"
        }
    }

    @Test
    fun `experimentelle APIs stehen unter OptIn`() {
        // ── Marcos dritter Build brach hier ab (Nachtrag 102) ────────────────
        //
        //     CatalogSections.kt:125:9 This material API is experimental …
        //
        // `@OptIn` steht in Kotlin an der DEKLARATION oder an der Datei. Beim
        // Aufteilen trug die Quellfunktion die Annotation — der herausgelöste
        // Block erbt sie nicht. Wie bei `private` ist das weder eine Import-
        // noch eine Namensfrage, sondern eine Annotationsfrage.
        //
        // Geprüft wird der ganze Baum, nicht nur die aufgeteilten Paare: Auch
        // ein neu geschriebenes Composable kann die Annotation vergessen.
        val noetig = mapOf(
            "ModalBottomSheet" to "ExperimentalMaterial3Api",
            "rememberModalBottomSheetState" to "ExperimentalMaterial3Api",
            "TopAppBar" to "ExperimentalMaterial3Api",
            "CenterAlignedTopAppBar" to "ExperimentalMaterial3Api",
            "LargeTopAppBar" to "ExperimentalMaterial3Api",
            "TopAppBarDefaults" to "ExperimentalMaterial3Api",
            "PullToRefreshBox" to "ExperimentalMaterial3Api",
            "SearchBar" to "ExperimentalMaterial3Api",
            "combinedClickable" to "ExperimentalFoundationApi",
            "stickyHeader" to "ExperimentalFoundationApi",
            "FlowRow" to "ExperimentalLayoutApi",
            "FlowColumn" to "ExperimentalLayoutApi",
        )
        val wurzel = java.io.File("src/main/java/ch/brickinventoryapp")
        val fehler = mutableListOf<String>()

        // Untergrenze (Nachtrag 118): Ein Dateilauf, der nichts findet, lässt
        // jede Sammelprüfung darunter stillschweigend bestehen.
        check(wurzel.walkTopDown().count { it.extension == "kt" } >= 20) {
            "Zu wenige Kotlin-Dateien unter ${'$'}{wurzel.path} — Pfad veraltet?"
        }
        for (f in wurzel.walkTopDown().filter { it.extension == "kt" }) {
            val roh = f.readText()
            val code = entkleide(roh).lines()
            val dateiweit = Regex("""@file:OptIn\(([^)]*)\)""").findAll(roh)
                .flatMap { it.groupValues[1].split(",").asSequence() }
                .map { it.trim().removeSuffix("::class") }.toSet()

            val starts = code.indices.filter {
                Regex("""^(?:private |internal |public )?(?:@\w+\s+)*fun\s+\w""").containsMatchIn(code[it])
            }
            for ((idx, s0) in starts.withIndex()) {
                val e0 = starts.getOrNull(idx + 1) ?: code.size
                var k = s0 - 1
                val anns = mutableListOf<String>()
                while (k >= 0 && (code[k].trim().startsWith("@") || code[k].isBlank())) {
                    if (code[k].trim().startsWith("@")) anns += code[k]
                    k--
                }
                val opt = anns.flatMap { a ->
                    Regex("""@OptIn\(([^)]*)\)""").findAll(a)
                        .flatMap { it.groupValues[1].split(",").asSequence() }.toList()
                }.map { it.trim().removeSuffix("::class") }.toSet() + dateiweit

                val rumpf = code.subList(s0, e0).joinToString("\n")
                for ((api, marker) in noetig) {
                    // ── Der volle Paketname kam an der Regel vorbei (Nachtrag 141)
                    //
                    // `(?<![\w.])` soll verhindern, dass `irgendwas.TopAppBar(`
                    // als Treffer zaehlt. Es schloss aber auch die vollstaendig
                    // qualifizierte Schreibweise aus:
                    //
                    //     androidx.compose.foundation.layout.FlowRow(
                    //
                    // Genau so stand die FlowRow der Set-Chips in
                    // PartsListScreen.kt — mit dem @OptIn im RUMPF, also in der
                    // Form, die HouseholdComposables.kt schon einmal
                    // „Unresolved reference 'invoke'" beschert hat. Die Regel
                    // sah sie nie. Eine Sache in zwei Schreibweisen, und die
                    // Suche kennt nur eine — dasselbe Muster wie schon mehrfach.
                    //
                    // Der androidx-Vorspann ist jetzt erlaubt; ein beliebiger
                    // Empfaenger davor weiterhin nicht.
                    if (Regex("""(?<![\w.])(?:androidx(?:\.\w+)*\.)?$api\s*[({]""")
                            .containsMatchIn(rumpf) && marker !in opt) {
                        fehler += "${f.name}:${s0 + 1} nutzt $api ohne @OptIn($marker::class)"
                    }
                }
            }
        }
        assert(fehler.isEmpty()) {
            "Experimentelle APIs ohne Opt-in:\n  " + fehler.joinToString("\n  ")
        }
    }

    @Test
    fun `ViewModel-Erweiterungen sind importiert`() {
        // ── Marcos vierter Build brach hier ab (Nachtrag 103) ────────────────
        //
        //     FinanceScreen.kt:64:48 Unresolved reference 'setScope'.
        //
        // `setScope` ist `internal fun MainViewModel.setScope(…)` in
        // ch.brickinventoryapp.ui (HouseholdFeature.kt). Die Screens liegen in
        // ch.brickinventoryapp.ui.SCREENS — ein anderes Paket.
        //
        // `import ch.brickinventoryapp.ui.MainViewModel` holt NUR die Klasse,
        // nicht ihre Erweiterungen. Dafür braucht es
        // `import ch.brickinventoryapp.ui.*`, wie SetDetailScreen.kt es seit
        // jeher hat.
        //
        // Beim Umbau in Nachtrag 96 wanderten die vm-Aufrufe aus den
        // Navigationsgraphen (Paket …nav, dort mit Wildcard) in die Screens und
        // verloren dabei die Sichtbarkeit. Es traf 23 Aufrufe in fünf Dateien;
        // Marco hat den ersten gemeldet.
        val wurzel = java.io.File("src/main/java/ch/brickinventoryapp")
        // Untergrenze (Nachtrag 118): ein leerer Dateilauf lässt jede
        // Sammelprüfung darunter stillschweigend bestehen.
        check(wurzel.walkTopDown().count { it.extension == "kt" } >= 20) {
            "Zu wenige Kotlin-Dateien unter ${'$'}{wurzel.path} — Pfad veraltet?"
        }
        val dateien = wurzel.walkTopDown().filter { it.extension == "kt" }.toList()

        // Erweiterung → Paket, in dem sie deklariert ist
        val erweiterung = mutableMapOf<String, String>()
        for (f in dateien) {
            val src = f.readText()
            val paket = Regex("""^package ([\w.]+)""", RegexOption.MULTILINE)
                .find(src)?.groupValues?.get(1) ?: continue
            for (m in Regex("""^(?:internal |public |private )?(?:suspend )?fun MainViewModel\.(\w+)""",
                    RegexOption.MULTILINE).findAll(entkleide(src))) {
                erweiterung[m.groupValues[1]] = paket
            }
        }

        val fehler = mutableListOf<String>()
        for (f in dateien) {
            val roh = f.readText()
            val paket = Regex("""^package ([\w.]+)""", RegexOption.MULTILINE)
                .find(roh)?.groupValues?.get(1) ?: continue
            val code = entkleide(roh)
            // Kommentar hinter der Importzeile zulassen — im Projekt üblich:
            //   import ch.brickinventoryapp.ui.*  // Feature-Extensions (…)
            val importe = Regex("""^import ([\w.*]+)\s*(?://.*)?$""", RegexOption.MULTILINE)
                .findAll(roh).map { it.groupValues[1] }.toSet()
            val wild = importe.filter { it.endsWith("*") }.map { it.dropLast(1) }.toSet()

            for ((name, quelle) in erweiterung) {
                if (quelle == paket) continue
                if ("$quelle.$name" in importe || "$quelle." in wild) continue
                if (Regex("""\bvm\.$name\s*\(""").containsMatchIn(code) ||
                    Regex("""\bvm::$name\b""").containsMatchIn(code)) {
                    fehler += "${f.name}: ruft vm.$name() — Erweiterung aus $quelle, nicht importiert"
                }
            }
        }
        assert(fehler.isEmpty()) {
            "ViewModel-Erweiterungen ohne Import:\n  " + fehler.joinToString("\n  ") +
                "\n(`import $\u007Bpaket\u007D.*` an den Dateikopf behebt das.)"
        }
    }

    @Test
    fun `jeder Projekt-Import hat ein Ziel`() {
        // ── Marcos fünfter Build brach hier ab (Nachtrag 105) ────────────────
        //
        //     SetDetailSections.kt:60:34 Unresolved reference 'fmtPrice'.
        //
        // Zeile 60 war ein IMPORT: `import ch.brickinventoryapp.util.fmtPrice`.
        // Den habe ich beim Erzeugen der Datei GERATEN — in util gibt es nur
        // fmtMoney, fmtMoneyOrDash und fmtInt. `fmtPrice` ist eine lokale
        // Funktion von SetDetailScreen und kommt seit Nachtrag 104 als
        // Parameter.
        //
        // Die bisherigen Prüfungen fragten, ob ein BENUTZTER Name gedeckt ist.
        // Diese fragt umgekehrt: Zeigt jeder Import auf etwas, das es gibt?
        val wurzel = java.io.File("src/main/java/ch/brickinventoryapp")
        // Untergrenze (Nachtrag 118): ein leerer Dateilauf lässt jede
        // Sammelprüfung darunter stillschweigend bestehen.
        check(wurzel.walkTopDown().count { it.extension == "kt" } >= 20) {
            "Zu wenige Kotlin-Dateien unter ${'$'}{wurzel.path} — Pfad veraltet?"
        }
        val dateien = wurzel.walkTopDown().filter { it.extension == "kt" }.toList()

        val deklariert = mutableSetOf<String>()
        for (f in dateien) {
            val src = f.readText()
            val paket = Regex("""^package ([\w.]+)""", RegexOption.MULTILINE)
                .find(src)?.groupValues?.get(1) ?: continue
            for (m in Regex(
                """^(?:@\w+\s+)?(?:internal |public |private )?(?:const )?(?:suspend |inline )?""" +
                """(?:fun|val|var|class|object|interface|enum class|data class|sealed class|typealias)""" +
                """\s+(?:<[^>]*>\s*)?(?:\w+\.)?(\w+)""",
                RegexOption.MULTILINE).findAll(src)) {
                deklariert += "$paket.${m.groupValues[1]}"
            }
        }

        val fehler = mutableListOf<String>()
        for (f in dateien) {
            for (m in Regex("""^import (ch\.brickinventoryapp\.[\w.]+)\s*(?://.*)?$""",
                    RegexOption.MULTILINE).findAll(f.readText())) {
                val voll = m.groupValues[1]
                if (voll.endsWith(".*")) continue
                // R und BuildConfig erzeugt das Bauwerkzeug, nicht der Quellbaum.
                if (voll.substringAfterLast('.') in setOf("R", "BuildConfig")) continue
                if (voll.contains(".R.")) continue
                if (voll in deklariert) continue
                // Geschachteltes Mitglied: die umgebende Klasse genügt.
                if (voll.substringBeforeLast('.') in deklariert) continue
                fehler += "${f.name}: import $voll — kein solches Ziel im Projekt"
            }
        }
        assert(fehler.isEmpty()) {
            "Importe ohne Ziel:\n  " + fehler.joinToString("\n  ")
        }
    }
}
