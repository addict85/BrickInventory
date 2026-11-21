package ch.brickinventoryapp.update

import ch.brickinventoryapp.update.util.UPDATE_RELEASE_BASE
import ch.brickinventoryapp.update.util.isAllowedApkAddress
import ch.brickinventoryapp.update.util.isNew
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Die App aktualisiert sich selbst — und tut es vorsichtig.
 *
 * ── Warum dieser Test schwerer wiegt als andere ─────────────────────────────
 * Ein Selbst-Updater ist der einzige Weg in dieser App, ueber den FREMDER CODE
 * auf das Geraet kommt. Jede der Regeln unten ist die Antwort auf eine Art,
 * wie das schiefgehen kann; faellt eine weg, faellt sie lautlos weg.
 *
 * Zwei der Pruefungen fuehren echten Code aus (isNew, isAllowedApkAddress
 * sind reine Funktionen). Die uebrigen lesen Quelltext: Verdrahtung und Netzkonfig.
 * Ausgeführt prüfen UpdateViewModelTest (Signatur, Prüfsumme, Angebot, „Später“),
 * UpdateLoaderTest (Obergrenzen), UpdateClientTest (der blanke Client) und
 * UpdateDialogTest (geladen wird erst auf den Klick).
 */
class SelfUpdateTest {

    // ── Die reinen Regeln, ausgefuehrt ──────────────────────────────────────

    /**
     * Ein Befund, den niemand zu sehen bekommt, ist kein Befund.
     *
     * Die stille Pruefung beim Start allein genügt nicht: AppNavigation.kt stoesst sie beim Start an
     * (`pruefeAufUpdate(still = true)`), und der Kommentar dort sagt
     * ausdruecklich, die Frage „gibt es etwas Neueres?" gelte DER GANZEN APP.
     *
     * NACHGEMESSEN war die Antwort trotzdem nur einem Bildschirm bekannt:
     * `updateState` wurde im ganzen Hauptbaum an GENAU EINER Stelle gelesen,
     * in account/ui/screens/SettingsScreen.kt — und der Bildschirm war damals von
     * nirgendwo erreichbar (siehe ReachableRoutesTest). Die Pruefung fand
     * also etwas, legte es ins ViewModel, und niemand zeichnete es.
     *
     * Der Weg wurde app-weit gemacht, die Anzeige nicht mitgenommen. Genau
     * diese Luecke soll hier auffallen, bevor sie wieder jemand meldet.
     */
    @Test
    fun `the result of the silent check is shown outside the settings too`() {
        // Gesucht wird das ABONNIEREN, nicht das blosse Vorkommen des Namens: Wer den
        // Zustand setzt oder haelt, nennt ihn auch und zeichnet nichts.
        //
        // `collectAsStateWithLifecycle` kann nur ein Composable, und ein
        // Composable, das ihn abonniert, zeichnet ihn auch.
        val reader = Quellen.alle()
            .filter { Quellen.withoutComments(it.readText()).contains("updateState.collectAsStateWithLifecycle") }
            .map { it.name }
            .toSet()
        val anzeigen = reader - setOf("SettingsScreen.kt")
        assert(anzeigen.isNotEmpty()) {
            "Ausser SettingsScreen.kt liest niemand updateState. Die Pruefung beim Start " +
                "(AppNavigation.kt, pruefeAufUpdate(still = true)) findet dann zwar etwas, " +
                "aber es ist nirgends zu sehen — genau der Zustand, den Marco gemeldet hat."
        }
    }

    @Test
    fun `only a truly higher version counts as newer`() {
        assert(isNew(100, 101)) { "Eine hoehere Fassung wird nicht erkannt" }
        assert(!isNew(100, 100)) { "Dieselbe Fassung gilt als Update" }
        // Der Punkt: Mit `!=` boete die App nach einem zurueckgenommenen Build
        // ein Downgrade an, das Android anschliessend mit
        // INSTALL_FAILED_VERSION_DOWNGRADE ablehnt — eine Sackgasse, aus der
        // der Nutzer nicht herausfindet.
        assert(!isNew(100, 99)) { "Eine AELTERE Fassung wird als Update angeboten" }
    }

    @Test
    fun `only addresses from our release store`() {
        assert(isAllowedApkAddress("$UPDATE_RELEASE_BASE/BrickInventory.apk")) {
            "Die eigene Adresse wird abgelehnt"
        }
        // Der klassische Praefix-Fehler: `startsWith(BASIS)` ohne Schraegstrich
        // liesse das hier durch. Genau diese Falle ist in network/util/NetworkPolicy.kt
        // schon einmal beim Bearer-Token behoben worden.
        assert(!isAllowedApkAddress("$UPDATE_RELEASE_BASE.angreifer.tld/x.apk")) {
            "Eine Adresse, die nur mit unserer ANFAENGT, wird zugelassen"
        }
        assert(!isAllowedApkAddress("https://angreifer.tld/BrickInventory.apk")) {
            "Eine voellig fremde Adresse wird zugelassen"
        }
        assert(!isAllowedApkAddress("$UPDATE_RELEASE_BASE/version.json")) {
            "Etwas anderes als ein APK wird als APK zugelassen"
        }
        assert(UPDATE_RELEASE_BASE.startsWith("https://")) {
            "Die Release-Ablage steht nicht auf HTTPS"
        }
    }

    // ── Die Regeln, die im Quelltext stehen ─────────────────────────────────

    private fun quelle(rel: String) = Quellen.withoutComments(Quellen.lies(rel))

    @Test
    fun `when unclear nothing is installed`() {
        val help = quelle("update/util/AppUpdate.kt")
        // Jedes `return null` in der Signaturermittlung fuehrt ueber die
        // `?: return false` in signatureFits zu „nicht installieren".
        assert(help.contains("val neu = fingerabdruecke(ctx, apk) ?: return false")) {
            "Ein unlesbares oder unsigniertes APK gilt nicht mehr als unzulaessig"
        }
        assert(help.contains("if (info.packageName != ctx.packageName) return null")) {
            "Der Paketname wird nicht geprueft — ein FREMDES Paket mit demselben " +
                "Schluessel kaeme durch"
        }
    }

    @Test
    fun `the check at start is silent`() {
        // Beim Start pruefen, nie von allein laden: Laden ist eine Entscheidung des Nutzers.
        val nav = quelle("app/AppNavigation.kt")
        // Der Start fragt über pruefeBeimStart(), das nur bei gesetztem Schalter still prüft; dass
        // die Anmeldung es auslöst, prüft UpdateViewModelTest am ausgeführten ViewModel.
        val vm = Quellen.function(Quellen.withoutComments(Quellen.lies("account/ui/viewmodel/UpdateViewModel.kt")), "fun pruefeBeimStart(")
        assert(vm.contains("pruefeAufUpdate(still = true)")) {
            "Beim Start wird nicht (mehr) still nach einem Update gesehen"
        }
        // Und sie laedt nichts: ladeUpdate() hat genau einen Ausloeser, den Knopf.
        assert(!nav.contains("ladeUpdate()")) {
            "Der Start stoesst das Herunterladen an — Marcos Vorgabe war ausdruecklich " +
                "„nie von allein laden\""
        }
    }

    @Test
    fun `the update trusts only system certificates`() {
        // Von GitHub kommt ein APK: nur System-CAs, kein Klartext.
        val cfg = File(Quellen.res, "xml/network_security_config.xml").readText()
        val ab = cfg.indexOf("<domain-config")
        assert(ab > 0) {
            "Es gibt keinen eigenen domain-config-Block mehr — dann gilt fuer GitHub " +
                "die base-config, und die vertraut nutzerinstallierten Zertifikaten."
        }
        val block = cfg.substring(ab, cfg.indexOf("</domain-config>", ab))
        for (host in listOf("github.com", "githubusercontent.com")) {
            assert(block.contains(host)) {
                "$host steht nicht im eigenen Block. Der Release-Anhang wird umgeleitet — " +
                    "beide Hosts werden gebraucht."
            }
        }
        assert(!block.contains("""src="user"""")) {
            "Der GitHub-Block vertraut wieder nutzerinstallierten Zertifikaten"
        }
        assert(block.contains("""cleartextTrafficPermitted="false"""")) {
            "Zu GitHub waere wieder Klartext erlaubt"
        }
        // Auch die base-config vertraut nur dem System; eigene CAs erlaubt der
        // Nutzer ausdrücklich, zur Laufzeit (ServerTrustTest).
        val basis = cfg.substring(cfg.indexOf("<base-config"))
        assert(!basis.contains("""src="user"""")) {
            "Die base-config vertraut wieder jeder nutzerinstallierten CA"
        }
    }

    @Test
    fun `the manifest allows installing, no provider exposes the update directory`() {
        val manifest = Quellen.manifest.readText()
        assert(manifest.contains("android.permission.REQUEST_INSTALL_PACKAGES")) {
            "Ohne die Berechtigung kann die App den Installer nicht oeffnen"
        }
        // Das APK geht per PackageInstaller-Sitzung ans System; eine Freigabe über
        // einen FileProvider gäbe es jeder App, die eine URI zugespielt bekommt.
        assert(!manifest.contains("FileProvider")) { "Ein FileProvider könnte das Update-Verzeichnis freigeben" }
    }

    @Test
    fun `the workflow puts the description next to the APK`() {
        // Ueber Quellen.workflow(), nicht mit eigener Pfadangabe: Gradle-Tests laufen
        // aus dem Modulordner, und ein eigener relativer Pfad verzählt sich leicht.
        // Releases sind unveränderlich: Die Beschreibung kommt im selben `gh release create`
        // wie das APK, und nur `--latest` bringt sie unter UPDATE_VERSION_URL.
        // Gegenprobe: `"$BESCHREIBUNG"` aus dem Aufruf oder `--latest=false` → rot „Der Workflow legt die Release ohne …“.
        val text = Quellen.workflow("android-release.yml")
        assert(Regex("""BESCHREIBUNG=app/build/outputs/version-signiert\.json\n""").containsMatchIn(text) &&
            Regex("""gh release create "\${'$'}QUELLE" [^\n]*"\${'$'}APK" "\${'$'}BESCHREIBUNG" [^\n]*\n\s*--verify-tag --latest """)
                .containsMatchIn(text)) {
            "Der Workflow legt die Release ohne version-signiert.json oder nicht als „Latest“ an — " +
                "ohne sie findet die App kein Update, ohne dass irgendwo etwas scheitert"
        }
        // Die Werte kommen aus AGPs output-metadata.json und werden NICHT hier
        // nochmal aus dem Datum erzeugt: Eine zweite Rechnung liefe Minuten
        // spaeter als die im Build und koennte einen Wert melden, den kein APK
        // traegt — die App boete dann ein Update an, das nach der Installation
        // immer noch „veraltet" ist.
        assert(text.contains("output-metadata.json")) {
            "Die Versionswerte werden nicht aus AGPs output-metadata.json gelesen"
        }
        assert(Quellen.workflow("android-signieren.yml").contains("{versionCode:${'$'}code, versionName:${'$'}name,")) {
            "Die Beschreibung traegt nicht beide Versionsangaben"
        }
    }

    @Test
    fun `no field promises a check that does not exist`() {
        // Das Feld traegt den Git-Commit, aus dem gebaut wurde. Hiesse es `sha`, laese es
        // sich neben `apkUrl` und `apkSize` als PRUEFSUMME DES APK.
        //
        // Eine echte Pruefsumme kaeme hier auch nicht in Frage: Sie stuende in
        // derselben Datei wie die Adresse — wer version.json faelscht,
        // faelscht sie mit. Die Integritaet traegt signatureFits() gegen die
        // INSTALLIERTE App, zusammen mit HTTPS.
        //
        // Geprueft werden BEIDE Seiten: der Workflow, der das Feld schreibt,
        // und das Datenmodell, das es liest. Nur eine Seite zu pruefen laesst
        // genau die Sorte Auseinanderlaufen zu, gegen die dieser Baum sonst
        // ueberall angeht.
        val workflow = Quellen.workflow("android-signieren.yml")
        assert(workflow.contains("commit:${'$'}commit")) {
            "Die Beschreibung traegt das Herkunftsfeld nicht mehr als `commit`"
        }
        assert(!workflow.contains("sha:${'$'}sha")) {
            "Das Feld heisst wieder `sha` — neben apkUrl und apkSize liest sich das " +
                "als Pruefsumme des APK, und eine solche Pruefung gibt es nicht"
        }
        // Quellen.lies() ist relativ zu ch/brickinventoryapp/ — siehe dort.
        val model = Quellen.lies("update/util/AppUpdate.kt")
        assert(model.contains("@SerialName(\"commit\")")) {
            "Das Datenmodell liest das Feld nicht als `commit` — dann bleibt es leer"
        }
    }

    // Was der Startdialog tut und nicht tut, prüft UpdateDialogTest gezeichnet; hier nur,
    // dass er über der ganzen App hängt.
    @Test
    fun `the dialog hangs over the whole app, not on one screen`() {
        val nav = Quellen.withoutComments(Quellen.lies("app/AppNavigation.kt"))
        assert(nav.contains("UpdateRoute(selbstUpdate)")) {
            "Der Update-Hinweis wird nirgends gezeigt. In einem einzelnen Bildschirm " +
                "aufgerufen bekaeme ihn nur, wer ohnehin dort sitzt — genau der Fehler, " +
                "den der Punkt in den Einstellungen schon einmal hatte."
        }
    }
}
