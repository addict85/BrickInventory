package ch.brickinventoryapp

import ch.brickinventoryapp.util.UPDATE_RELEASE_BASIS
import ch.brickinventoryapp.util.istErlaubteApkAdresse
import ch.brickinventoryapp.util.istNeuer
import org.junit.Test

/**
 * Die App aktualisiert sich selbst — und tut es vorsichtig.
 *
 * ── Marcos Wunsch ───────────────────────────────────────────────────────────
 * „Wie gross waere der Aufwand dass sich die Android-App selbstaendig mit
 * Hilfe des bereitgestellten apk updatet?" — beim Start still pruefen, nie von
 * allein laden, plus ein Knopf in den Einstellungen.
 *
 * ── Warum dieser Test schwerer wiegt als andere ─────────────────────────────
 * Ein Selbst-Updater ist der einzige Weg in dieser App, ueber den FREMDER CODE
 * auf das Geraet kommt. Jede der Regeln unten ist die Antwort auf eine Art,
 * wie das schiefgehen kann; faellt eine weg, faellt sie lautlos weg.
 *
 * Zwei der Pruefungen fuehren echten Code aus (istNeuer, istErlaubteApkAdresse
 * sind reine Funktionen). Die uebrigen lesen Quelltext — die Alternative waere
 * ein Geraet, und das hat dieser Lauf nicht.
 */
class SelbstUpdateTest {

    // ── Die reinen Regeln, ausgefuehrt ──────────────────────────────────────

    @Test
    fun `nur eine echt hoehere Fassung gilt als neuer`() {
        assert(istNeuer(100, 101)) { "Eine hoehere Fassung wird nicht erkannt" }
        assert(!istNeuer(100, 100)) { "Dieselbe Fassung gilt als Update" }
        // Der Punkt: Mit `!=` boete die App nach einem zurueckgenommenen Build
        // ein Downgrade an, das Android anschliessend mit
        // INSTALL_FAILED_VERSION_DOWNGRADE ablehnt — eine Sackgasse, aus der
        // der Nutzer nicht herausfindet.
        assert(!istNeuer(100, 99)) { "Eine AELTERE Fassung wird als Update angeboten" }
    }

    @Test
    fun `nur Adressen aus unserer Release-Ablage`() {
        assert(istErlaubteApkAdresse("$UPDATE_RELEASE_BASIS/BrickInventory.apk")) {
            "Die eigene Adresse wird abgelehnt"
        }
        // Der klassische Praefix-Fehler: `startsWith(BASIS)` ohne Schraegstrich
        // liesse das hier durch. Genau diese Falle ist in util/NetworkPolicy.kt
        // schon einmal beim Bearer-Token behoben worden.
        assert(!istErlaubteApkAdresse("$UPDATE_RELEASE_BASIS.angreifer.tld/x.apk")) {
            "Eine Adresse, die nur mit unserer ANFAENGT, wird zugelassen"
        }
        assert(!istErlaubteApkAdresse("https://angreifer.tld/BrickInventory.apk")) {
            "Eine voellig fremde Adresse wird zugelassen"
        }
        assert(!istErlaubteApkAdresse("$UPDATE_RELEASE_BASIS/version.json")) {
            "Etwas anderes als ein APK wird als APK zugelassen"
        }
        assert(UPDATE_RELEASE_BASIS.startsWith("https://")) {
            "Die Release-Ablage steht nicht auf HTTPS"
        }
    }

    // ── Die Regeln, die im Quelltext stehen ─────────────────────────────────

    private fun quelle(rel: String) = Quellen.ohneKommentare(Quellen.lies(rel))

    @Test
    fun `die Signatur wird geprueft, bevor der Nutzer gefragt wird`() {
        val feature = quelle("ui/UpdateFeature.kt")
        assert(feature.contains("signaturPasst(ctx, ziel)")) {
            "Das geladene APK wird nicht gegen die Signatur der installierten App geprueft. " +
                "Android lehnt es zwar ohnehin ab — aber dann steht der Nutzer vor einer " +
                "Fehlermeldung, NACHDEM er zugestimmt hat."
        }
        assert(feature.contains("ziel.delete()")) {
            "Ein APK mit falscher Signatur bleibt liegen, statt geloescht zu werden"
        }
        // Auch der zweite Weg (Erlaubnis nachtraeglich erteilt) prueft erneut:
        // Zwischen Download und zweitem Anlauf liegt ein Ausflug in die
        // Systemeinstellungen, und die Datei liegt so lange auf der Platte.
        val starte = feature.substringAfter("fun MainViewModel.starteInstallation()")
        assert(starte.contains("signaturPasst(ctx, datei)")) {
            "Der zweite Installationsweg prueft die Signatur nicht"
        }
    }

    @Test
    fun `bei Unklarheit wird nicht installiert`() {
        val hilfe = quelle("util/AppUpdate.kt")
        // Jedes `return null` in der Signaturermittlung fuehrt ueber die
        // `?: return false` in signaturPasst zu „nicht installieren".
        assert(hilfe.contains("val neu = fingerabdruecke(ctx, apk) ?: return false")) {
            "Ein unlesbares oder unsigniertes APK gilt nicht mehr als unzulaessig"
        }
        assert(hilfe.contains("if (info.packageName != ctx.packageName) return null")) {
            "Der Paketname wird nicht geprueft — ein FREMDES Paket mit demselben " +
                "Schluessel kaeme durch"
        }
    }

    @Test
    fun `die Pruefung beim Start ist still`() {
        // Marcos Vorgabe: beim Start pruefen, nie von allein laden.
        val nav = quelle("AppNavigation.kt")
        assert(nav.contains("pruefeAufUpdate(still = true)")) {
            "Beim Start wird nicht (mehr) still nach einem Update gesehen"
        }
        val feature = quelle("ui/UpdateFeature.kt")
        assert(feature.contains("if (still) null")) {
            "Die stille Pruefung hinterlaesst eine Fehlermeldung — wer ohne Netz " +
                "startet, saehe bei jedem Start eine rote Zeile"
        }
        // Und sie laedt nichts: ladeUpdate() hat genau einen Ausloeser, den Knopf.
        assert(!nav.contains("ladeUpdate()")) {
            "Der Start stoesst das Herunterladen an — Marcos Vorgabe war ausdruecklich " +
                "„nie von allein laden\""
        }
    }

    @Test
    fun `der Update-Client traegt keinen Token`() {
        val di = quelle("di/AppModule.kt")
        val ab = di.indexOf("fun provideUpdateOkHttpClient()")
        assert(ab > 0) { "Es gibt keinen eigenen Client fuer die Aktualisierung mehr" }
        val bis = di.indexOf("@Provides", ab + 10).let { if (it < 0) di.length else it }
        val block = di.substring(ab, bis)
        assert(!block.contains("buildInterceptorClient")) {
            "Der Update-Client geht ueber buildInterceptorClient — der kennt unseren " +
                "Server, unseren Bearer-Token und unsere Anzeigesprache. Nichts davon " +
                "geht GitHub etwas an."
        }
        assert(!block.contains("Authorization")) {
            "Der Update-Client setzt einen Authorization-Kopf"
        }
    }

    @Test
    fun `das Manifest erlaubt das Installieren und gibt nur update-- frei`() {
        val manifest = java.io.File("src/main/AndroidManifest.xml").readText()
        assert(manifest.contains("android.permission.REQUEST_INSTALL_PACKAGES")) {
            "Ohne die Berechtigung kann die App den Installer nicht oeffnen"
        }
        val pfade = java.io.File("src/main/res/xml/file_paths.xml").readText()
        assert(pfade.contains("""<files-path name="update_internal" path="update/" />""")) {
            "Der FileProvider gibt das Update-Verzeichnis nicht frei — dann wirft " +
                "getUriForFile eine IllegalArgumentException"
        }
        // NUR intern: Ein APK im externen Bereich waere fuer jede App mit
        // Speicherzugriff lesbar UND beschreibbar — und ein beschreibbares APK,
        // das wir gleich zur Installation weiterreichen, ist genau die Luecke,
        // die ein Selbst-Updater nicht haben darf.
        assert(!pfade.contains("""external-files-path name="update""")) {
            "Das Update-Verzeichnis ist auch extern freigegeben"
        }
    }

    @Test
    fun `der Workflow legt die Beschreibung neben das APK`() {
        val wf = java.io.File("../.github/workflows/android.yml")
        assert(wf.isFile) { "android.yml nicht gefunden unter ${wf.absolutePath}" }
        val text = wf.readLines().filterNot { it.trimStart().startsWith("#") }.joinToString("\n")
        assert(text.contains("""gh release upload "${'$'}ETIKETT" version.json --clobber""")) {
            "Der Workflow laedt keine version.json mehr hoch — ohne sie findet die App " +
                "kein Update, ohne dass irgendwo etwas scheitert"
        }
        // Die Werte kommen aus AGPs output-metadata.json und werden NICHT hier
        // nochmal aus dem Datum erzeugt: Eine zweite Rechnung liefe Minuten
        // spaeter als die im Build und koennte einen Wert melden, den kein APK
        // traegt — die App boete dann ein Update an, das nach der Installation
        // immer noch „veraltet" ist.
        assert(text.contains("output-metadata.json")) {
            "Die Versionswerte werden nicht aus AGPs output-metadata.json gelesen"
        }
        assert(text.contains("versionCode") && text.contains("versionName")) {
            "version.json traegt nicht beide Versionsangaben"
        }
    }
}
