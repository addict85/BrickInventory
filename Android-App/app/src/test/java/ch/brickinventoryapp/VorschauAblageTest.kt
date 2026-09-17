package ch.brickinventoryapp

import org.junit.Test

/**
 * Die Vorschaubilder liegen dauerhaft, nicht nur zwischengespeichert.
 *
 * ── Marcos Anforderung ──────────────────────────────────────────────────────
 * „Die Android-App soll auch ohne Internet funktionieren", Umfang: „nur fuer
 * Vorschau Bilder."
 *
 * ── Warum es die zwei Caches nicht schon taten ──────────────────────────────
 *
 * Die App hatte zwei Zwischenspeicher fuer Bilder (Coil und OkHttp, je 50 MB).
 * Beide liegen unter `cacheDir`, und das Wort steht dort nicht zufaellig: Was
 * dort liegt, darf Android jederzeit loeschen, wenn der Platz knapp wird — ohne
 * Rueckfrage und ohne Ruecksicht darauf, was morgen gebraucht wird. Beide sind
 * ausserdem LRU: Wer durch den Katalog blaettert, verdraengt damit die Bilder
 * der eigenen Sammlung.
 *
 * Die Ablage liegt unter `filesDir`. Das ist der ganze Unterschied zwischen
 * „meistens noch da" und „da" — und deshalb die erste Pruefung hier.
 *
 * ── Warum keine Datenbank ───────────────────────────────────────────────────
 *
 * Naheliegend waere Room gewesen; der Nutzen einer Datenbank ist ein
 * durchsuchbarer Index, und bei einem Bild IST der Index der Dateiname. Groesse
 * und Alter stehen im Dateisystem. Room haette eine Abhaengigkeit samt
 * Annotationsverarbeitung gebracht, ohne eine Frage zu beantworten, die sonst
 * offen bliebe.
 *
 * Der Test liest nur Quelltext: kein Geraet, kein Android.
 */
class VorschauAblageTest {

    private fun quelle(rel: String) =
        Quellen.ohneKommentare(Quellen.lies(rel))

    @Test
    fun `die Ablage liegt dort, wo Android nicht aufraeumt`() {
        val s = quelle("data/cache/VorschauSpeicher.kt")
        assert(s.contains("context.filesDir")) {
            "Die Ablage liegt nicht unter filesDir. Unter cacheDir darf Android " +
                "sie jederzeit loeschen — dann ist sie ein dritter Cache und " +
                "loest genau nichts."
        }
        assert(!s.contains("cacheDir")) {
            "Die Ablage benutzt cacheDir. Siehe oben: Das ist der Unterschied, " +
                "um den es hier geht."
        }
    }

    @Test
    fun `nur Vorschaubilder, und die Ablage waechst nicht unbegrenzt`() {
        val s = quelle("data/cache/VorschauSpeicher.kt")
        // Marcos Zuschnitt. Die volle Aufloesung wird einzeln im Detaildialog
        // angesehen; ein paar hundert davon fuellten die Ablage mit etwas, das
        // offline niemand vermisst.
        assert(s.contains("fun istVorschau(")) {
            "Es gibt keine Unterscheidung mehr zwischen Vorschau und voller " +
                "Aufloesung — dann landet alles in der Ablage"
        }
        // Unter filesDir raeumt niemand ausser uns. Ohne Obergrenze waechst die
        // Ablage, bis das Telefon voll ist, und niemand fiele es auf.
        // Auf die DEFINITION geprueft, nicht auf den Namen: Die erste Fassung
        // suchte nur "MAX_BYTES" irgendwo in der Datei. Die Gegenprobe (Zeile
        // mit `const val` entfernt) blieb damit gruen, weil die VERWENDUNG
        // weiter unten stehen blieb — eine Zusicherung, die den Namen findet,
        // aber nicht die Sache.
        assert(Regex("""const val MAX_BYTES = \d""").containsMatchIn(s)) {
            "Die Ablage hat keine Obergrenze. Unter filesDir raeumt Android " +
                "nichts weg — sie waechst dann, bis der Speicher voll ist."
        }
        assert(s.contains("private fun aufraeumenFallsNoetig()")) {
            "Die Obergrenze steht da, wird aber nie durchgesetzt"
        }
        // Halbe Dateien sehen aus wie Bilder. Derselbe Fehler ist im Bild-Proxy
        // des Servers schon einmal passiert.
        assert(s.contains(".tmp") && s.contains("renameTo")) {
            "Geschrieben wird nicht ueber eine Nebendatei — ein Abbruch " +
                "hinterlaesst dann eine halbe Datei, und die sieht aus wie ein Bild"
        }
    }

    @Test
    fun `der Abgriff ergaenzt den Zwischenspeicher, statt ihn abzuschalten`() {
        val s = quelle("di/AppModule.kt")

        // Reihenfolge: Anwendungs-Interceptoren laufen so, wie sie gesetzt
        // werden. Die Ablage muss AUSSEN sitzen, damit sie das Endergebnis des
        // Offline-Rueckfalls sieht — auch dessen 504, wenn dort nichts lag.
        val ablage = s.indexOf("vorschau.istVorschau(")
        val rueckfall = s.indexOf("CacheControl.FORCE_CACHE")
        assert(ablage > 0 && rueckfall > 0) { "Ablage oder Offline-Rueckfall fehlen" }
        assert(ablage < rueckfall) {
            "Der Ablage-Abgriff sitzt HINTER dem Offline-Rueckfall. Dann sieht " +
                "er dessen 504 nicht und springt genau dann nicht ein, wenn es " +
                "darauf ankommt."
        }
        assert(s.contains("antwort.code == 504")) {
            "Der 504 des erzwungenen Zwischenspeichers wird nicht abgefangen — " +
                "das ist aber der Normalfall, wenn dort nichts lag"
        }

        // ── Der Fehler, den diese Zusicherung verhindert ────────────────────
        //
        // Die erste Fassung setzte selbst ein If-None-Match aus einem
        // gespeicherten ETag. OkHttp haelt eine Anfrage mit dieser Kopfzeile
        // fuer BEREITS bedingt und uebergeht dann seinen eigenen Cache. Der
        // Abgriff haette also ausgerechnet den Zwischenspeicher abgeschaltet,
        // den er ergaenzen soll — und bei fehlender Datei ein nacktes 304 an
        // Coil weitergereicht.
        assert(!s.contains("If-None-Match")) {
            "Der Abgriff setzt wieder If-None-Match. Damit uebergeht OkHttp " +
                "seinen eigenen Cache, und die bedingte Anfrage fuehrt niemand " +
                "mehr richtig."
        }

        // peekBody: Der Rumpf darf nur EINMAL gelesen werden, und der Aufrufer
        // braucht ihn noch.
        assert(s.contains("peekBody(")) {
            "Die Bytes werden nicht mit peekBody genommen — dann ist der Rumpf " +
                "verbraucht, bevor Coil ihn sieht, und es bleibt leer"
        }
    }

    @Test
    fun `offline wird angezeigt, nicht geaendert`() {
        // ── Marcos Vorgabe ──────────────────────────────────────────────────
        // „Die Aenderungen sollen nur moeglich sein wenn die app online ist.
        // Ansonsten soll rein die Anzeige funktionieren."
        //
        // Das ist heute so — und zwar durch den AUFBAU, nicht durch eine
        // Abfrage: Der API-Client hat keinen Zwischenspeicher und keinen
        // Offline-Rueckfall, also geht jede Aenderung ans Netz und scheitert
        // ohne Netz sichtbar. Diese Pruefung haelt das fest, denn der
        // naheliegende naechste Schritt waere eine Warteschlange fuer
        // Aenderungen — und genau die will Marco nicht: Sie braeuchte eine
        // Antwort darauf, was gilt, wenn sich beide Seiten geaendert haben.
        val modul = Quellen.ohneKommentare(Quellen.lies("di/AppModule.kt"))
        val ab = modul.indexOf("fun provideApiOkHttpClient")
        assert(ab > 0) { "Der API-Client ist nicht mehr zu finden" }
        // Bis zum naechsten @Provides: nur dieser eine Client.
        val bis = modul.indexOf("@Provides", ab).let { if (it > 0) it else modul.length }
        val apiClient = modul.substring(ab, bis)
        assert(!apiClient.contains(".cache(")) {
            "Der API-Client hat einen Zwischenspeicher bekommen. Dann koennte " +
                "eine Antwort auf eine Aenderung aus dem Cache stammen — und " +
                "die Oberflaeche haelte etwas fuer gespeichert, was nie ankam."
        }
        assert(!apiClient.contains("FORCE_CACHE") && !apiClient.contains("onlyIfCached")) {
            "Der API-Client hat einen Offline-Rueckfall bekommen. Fuer Lesewege " +
                "gibt es den ResponseCache; fuer Aenderungen darf es ihn nicht " +
                "geben."
        }

        // Und der Lese-Zwischenspeicher bleibt einer: Er ersetzt eine
        // gescheiterte Abfrage durch die letzte bekannte Antwort — mehr nicht.
        val basis = Quellen.ohneKommentare(Quellen.lies("data/repository/RepoBasis.kt"))
        val fn = Quellen.funktion(basis, "protected suspend fun <T : Any> cached(")
        assert(fn.isNotEmpty()) { "cached() fehlt" }
        assert(fn.contains("if (fresh is Result.Error && fresh.unauthorized) return fresh")) {
            "cached() liefert auch bei abgelaufener Anmeldung die alte Antwort. " +
                "Dann sieht man nach dem Abmelden weiter fremde Daten."
        }
    }

    @Test
    fun `die Ablage laesst sich sehen und leeren`() {
        // 150 MB unter filesDir raeumt niemand ausser dem Nutzer. Ohne Anzeige
        // waechst auf dem Telefon etwas, das man nicht findet.
        val vm = quelle("ui/MainViewModel.kt")
        val ui = quelle("ui/screens/MonitoringSections.kt")
        assert(vm.contains("fun vorschauAblageBytes()") && vm.contains("fun vorschauAblageLeeren()")) {
            "Die Zugaenge zur Ablage fehlen im ViewModel"
        }
        assert(ui.contains("vm.vorschauAblageBytes()") && ui.contains("vm.vorschauAblageLeeren()")) {
            "Die Einstellungen zeigen die Ablage nicht an oder lassen sie nicht " +
                "leeren — dann waechst sie unsichtbar"
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Das Vorwaermen (Nachtrag 159)
    //
    // Marcos Anforderung: „Ergaenzen dass die Android-App bereits im
    // Hintergrund Bilder cached auch wenn diese noch nicht aufgerufen wurden
    // aus allen Reiter. Dabei soll nicht mehr als 80% des Speichercaches
    // genutzt werden."
    //
    // Bis dahin fuellte sich die Ablage NUR als Nebenwirkung des Hinsehens.
    // Wer die App online nie geoeffnet hatte, hatte offline nichts — und genau
    // dann braucht man sie.
    // ────────────────────────────────────────────────────────────────────────

    @Test
    fun `das Vorwaermen hoert bei vier Fuenfteln auf`() {
        val sp = quelle("data/cache/VorschauSpeicher.kt")
        // Auf die DEFINITION, nicht auf den Namen — dieselbe Lehre wie bei
        // MAX_BYTES weiter oben: Eine Zusicherung, die nur den Namen sucht,
        // bleibt gruen, wenn die Definition verschwindet und eine Verwendung
        // stehen bleibt.
        assert(Regex("""const val GRENZE_VORWAERMEN = MAX_BYTES / 5 \* 4""").containsMatchIn(sp)) {
            "Die 80-Prozent-Grenze fuer das Vorwaermen fehlt oder rechnet anders. " +
                "Ganzzahlig (/ 5 * 4), weil const val in Kotlin keinen " +
                "Fliesskomma-Ausdruck mit .toLong() vertraegt."
        }

        val vw = quelle("data/cache/VorschauVorwaermer.kt")
        // ZWEIMAL geprueft, und das ist der Punkt: einmal vor dem Sammeln,
        // damit ein voller Speicher nicht bei jedem App-Start vier
        // Listenabrufe kostet, und einmal je Schub, weil waehrenddessen auch
        // der normale Betrieb Bilder ablegt.
        val stellen = Regex("""belegt\(\) >= VorschauSpeicher\.GRENZE_VORWAERMEN""")
            .findAll(vw).count()
        assert(stellen >= 2) {
            "Die Grenze wird nur an $stellen Stelle(n) geprueft. Noetig sind " +
                "zwei: vor dem Sammeln und je Schub — sonst laeuft ein " +
                "begonnener Durchlauf ueber die Grenze hinaus weiter."
        }
    }

    @Test
    fun `vorgewaermte Bilder fliegen beim Aufraeumen zuerst`() {
        val sp = quelle("data/cache/VorschauSpeicher.kt")
        // ── Der Fehler, den diese Zusicherung verhindert ────────────────────
        //
        // aufraeumenFallsNoetig() wirft die AELTESTEN zuerst weg. Ohne
        // Gegenmassnahme waere ein soeben vorgewaermtes Bild das JUENGSTE und
        // damit sicherer als eines, das jemand vor zwei Wochen wirklich
        // angesehen hat — die Spekulation verdraengte die Sammlung.
        assert(sp.contains("spekulativ: Boolean = false")) {
            "schreibe() unterscheidet nicht mehr zwischen geraten und " +
                "gebraucht. Dann verdraengt das Vorwaermen beim Aufraeumen " +
                "genau die Bilder, die jemand wirklich angesehen hat."
        }
        assert(Regex("""spekulativ\) ziel\.setLastModified\(""").containsMatchIn(sp)) {
            "Vorgewaermte Bilder bekommen keinen alten Zeitstempel mehr — " +
                "siehe oben, sie stehen dann am Ende der Raeumschlange statt " +
                "am Anfang."
        }

        // Und der Uebergang „geraten" -> „gebraucht": Der Vorwaermer markiert
        // seine Anfragen, der Abgriff liest die Marke. Wer ein Bild ansieht,
        // markiert nicht — es wird beim ersten echten Aufruf von selbst zu
        // einem gebrauchten.
        val modul = quelle("di/AppModule.kt")
        assert(modul.contains("anfrage.tag(") && modul.contains("Vorwaermung::class.java")) {
            "Der Abgriff liest die Vorwaerm-Marke nicht mehr. Dann legt er " +
                "auch spekulativ geholte Bilder als gebraucht ab."
        }
        val vw = quelle("data/cache/VorschauVorwaermer.kt")
        assert(vw.contains(".tag(Vorwaermung::class.java, Vorwaermung)")) {
            "Der Vorwaermer markiert seine Anfragen nicht mehr"
        }
        // Eine Kopfzeile ginge an den Server und erzaehlte ihm etwas, das ihn
        // nichts angeht. OkHttp-Tags bleiben auf dem Geraet.
        assert(!vw.contains("X-Vorwaerm") && !vw.contains(".header(")) {
            "Die Marke reist als Kopfzeile zum Server. Sie ist eine reine " +
                "Angelegenheit des Geraets — dafuer gibt es OkHttp-Tags."
        }
    }

    @Test
    fun `vorgewaermt wird die Sammlung, nicht der Katalog`() {
        val vw = quelle("data/cache/VorschauVorwaermer.kt")
        // Alle Reiter, die Kacheln der EIGENEN Sammlung zeigen. Die manuell
        // erfassten Teile und Figuren erscheinen auch im Finanzen-Reiter — es
        // sind dieselben Bilder, deshalb steht Finanzen hier nicht eigens.
        // `ruf` und nicht `quelle`: Der Name waere sonst die Methode dieser
        // Klasse, und eine Schleifenvariable, die eine Methode verdeckt, ist
        // die Sorte Stolperstein, die erst beim naechsten Bearbeiten zubeisst.
        for (ruf in listOf(
            "repo.sets.getSets(", "repo.teile.getParts(", "repo.teile.getMinifigs(",
            "repo.teile.getManualParts(", "repo.teile.getManualMinifigs(",
        )) {
            assert(vw.contains(ruf)) {
                "Der Reiter hinter $ruf wird nicht mehr vorgewaermt — " +
                    "Marcos Vorgabe war „aus allen Reiter\""
            }
        }
        // ── Warum der Katalog NICHT ──────────────────────────────────────────
        //
        // Er ist nicht die Sammlung, sondern das Verzeichnis ALLER Sets, die es
        // gibt — rund 25'000. Bei etwa 15 kB je Vorschau waeren das ueber
        // 350 MB: mehr als das Doppelte der ganzen Ablage und ein Vielfaches
        // der Grenze. Das Vorwaermen braeche mittendrin ab, haette dabei das
        // Mobilfunkvolumen aufgebraucht und ausgerechnet die eigene Sammlung
        // verdraengt.
        assert(!vw.contains("getCatalog") && !vw.contains("katalog") && !vw.contains("Katalog(")) {
            "Der Katalog wird vorgewaermt. 25'000 Sets sprengen die Grenze um " +
                "ein Vielfaches und verdraengen dabei die eigene Sammlung."
        }
    }

    @Test
    fun `das Vorwaermen draengelt sich nicht vor`() {
        val vw = quelle("data/cache/VorschauVorwaermer.kt")
        // Der Bild-Client laeuft mit maxRequestsPerHost = 6. Nimmt sich das
        // Vorwaermen davon zu viele, wartet die sichtbare Kachelwand auf
        // Bilder, die gerade niemand ansieht.
        val proHost = Regex("""maxRequestsPerHost\s*=\s*(\d+)""")
            .find(quelle("di/AppModule.kt"))?.groupValues?.get(1)?.toInt()
        assert(proHost != null) { "maxRequestsPerHost ist nicht mehr zu finden" }
        val gleichzeitig = Regex("""GLEICHZEITIG = (\d+)""").find(vw)?.groupValues?.get(1)?.toInt()
        assert(gleichzeitig != null) { "GLEICHZEITIG fehlt" }
        assert(gleichzeitig!! < proHost!!) {
            "Das Vorwaermen nimmt sich $gleichzeitig von $proHost Verbindungen " +
                "je Host. Dann wartet die sichtbare App auf Bilder, die gerade " +
                "niemand ansieht."
        }
        // Beim App-Start konkurriert alles um dieselbe Leitung. Die
        // Vorwaermung hat es als Einzige nicht eilig.
        assert(Regex("""const val ANLAUF_MS = \d""").containsMatchIn(vw)) {
            "Der Anlauf fehlt — das Vorwaermen startet dann mitten in Anmeldung " +
                "und erster Kachelwand"
        }
        assert(vw.contains("delay(PAUSE_MS)")) {
            "Zwischen den Schueben wird nicht mehr pausiert"
        }
    }

    @Test
    fun `das Vorwaermen liest nur`() {
        // Marcos Bedingung aus derselben Reihe: „Die Aenderungen sollen nur
        // moeglich sein wenn die app online ist. Ansonsten soll rein die
        // Anzeige funktionieren." Ein Vorwaermer, der unterwegs etwas
        // schriebe, waere der erste Bruch dieser Zusage — und er faellt nicht
        // auf, weil er im Hintergrund laeuft.
        val vw = quelle("data/cache/VorschauVorwaermer.kt")
        for (verb in listOf(".post(", ".put(", ".patch(", ".delete(")) {
            assert(!vw.contains(verb)) {
                "Der Vorwaermer benutzt $verb. Er darf ausschliesslich lesen."
            }
        }
        // Und er holt nur, was die Ablage auch behaelt: Was istVorschau()
        // verneint, wuerde der Abgriff gar nicht erst schreiben — es zu holen
        // waere reines Datenvolumen ohne Ertrag.
        assert(vw.contains("vorschau.istVorschau(it)") && vw.contains("!vorschau.hat(it)")) {
            "Der Vorwaermer holt auch, was schon daliegt oder was die Ablage " +
                "ohnehin nicht behaelt — beides ist bezahltes Datenvolumen " +
                "ohne Gegenwert."
        }
    }
}
