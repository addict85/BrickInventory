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
}
