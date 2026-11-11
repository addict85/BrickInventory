package ch.brickinventoryapp.offline

import kotlinx.coroutines.flow.mapLatest
import ch.brickinventoryapp.model.lokal.Bestandsart
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.model.data.model.FigValuationItem
import ch.brickinventoryapp.model.data.model.Gutschein
import ch.brickinventoryapp.model.data.model.Merkposten
import ch.brickinventoryapp.model.data.model.Minifig
import ch.brickinventoryapp.model.data.model.Part
import ch.brickinventoryapp.model.data.model.PartValuationItem
import ch.brickinventoryapp.model.data.model.SetItem
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import java.util.UUID

/** Eine lokale Liste mit Typ, Schlüssel, Serializer und den Spalten, nach denen sie gefiltert wird. */
class Fach<T : Any>(
    val art: Bestandsart,
    val serializer: KSerializer<T>,
    val schluessel: (T) -> String,
    val spalten: (T) -> Filterspalten = { Filterspalten() },
)

object Faecher {
    val SETS = Fach(Bestandsart.SETS, SetItem.serializer(), { it.setNumber }) {
        // Wie der Server: Nummer, Name, Thema und Jahr (ohne Jahr „0“).
        Filterspalten(suchtext(it.setNumber, it.name, it.theme.orEmpty(), (it.year ?: 0).toString()),
            thema = it.theme, lagerort = it.storage)
    }
    val MERKLISTE = Fach(Bestandsart.MERKLISTE, Merkposten.serializer(), { LokaleAnwendung.merkSchluessel(it) }) {
        Filterspalten(suchtext(it.setNumber, it.name), zustand = it.condition.kennung)
    }
    val TEILE = Fach(Bestandsart.TEILE, Part.serializer(), { "${it.partNumber}|${it.colorId}|${it.isSpare}" }) {
        Filterspalten(suchtext(it.partNumber, it.partName, it.blPartNumber), farbe = it.colorName,
            kategorie = it.categoryName, ersatzteil = it.isSpare)
    }
    val FIGUREN = Fach(Bestandsart.FIGUREN, Minifig.serializer(), { it.figNumber }) {
        Filterspalten(suchtext(it.figNumber, it.figName))
    }
    val MANUELLE_TEILE = Fach(Bestandsart.MANUELLE_TEILE, PartValuationItem.serializer(),
        { "${it.partNumber}|${it.colorId}|${it.userId}" }) {
        Filterspalten(suchtext(it.partNumber, it.partName, it.blPartNumber), lagerort = it.storage)
    }
    val MANUELLE_FIGUREN = Fach(Bestandsart.MANUELLE_FIGUREN, FigValuationItem.serializer(),
        { "${it.figNumber}|${it.userId}" }) {
        Filterspalten(suchtext(it.figNumber, it.figName))
    }
    val GUTSCHEINE = Fach(Bestandsart.GUTSCHEINE, Gutschein.serializer(), { it.id.toString() })

    private fun suchtext(vararg felder: String?) = felder.filterNotNull().joinToString("\n").lowercase()
}

/** Plant das Senden des Ausgangs; im Gerät über WorkManager (AusgangWorker). */
fun interface AusgangPlaner {
    fun plane()
}

/**
 * Die lokale Wahrheit der Oberfläche: Listen und Ausgang je Bereich (Server und
 * Konto). Der Server bleibt massgeblich — was er liefert, ersetzt die Liste;
 * noch nicht gesendete Bearbeitungen werden danach wieder darübergelegt, damit
 * sie nicht kurz verschwinden, bis der Ausgang leer ist. Gebaut wird sie in
 * core-data, das den Bereich des angemeldeten Kontos kennt.
 */
class Offlineablage(
    private val bestand: LokalerBestand,
    /** Ein Test gibt einen SpeicherAusgang hinein und sieht dort nach; die Ablage zeigt ihn nicht. */
    private val ausgang: Ausgang,
    private val bereichQuelle: suspend () -> String?,
    private val planer: AusgangPlaner = AusgangPlaner {},
    private val uhr: () -> Long = System::currentTimeMillis,
    private val schluesselQuelle: () -> String = { UUID.randomUUID().toString() },
) {
    private val aktuell = MutableStateFlow<String?>(null)

    /** Der gültige Bereich, gestreut; null = nicht angemeldet, dann wird nichts abgelegt. */
    suspend fun bereich(): String? =
        fangeAusserAbbruch { bereichQuelle() }.getOrNull()?.takeIf { it.isNotBlank() }.also { aktuell.value = it }

    /** Wie viele Bearbeitungen noch auf den Server warten. */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun offene(): Flow<Int> = aktuell.flatMapLatest { b -> if (b == null) flowOf(0) else ausgang.anzahl(b) }

    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T : Any> beobachte(fach: Fach<T>): Flow<Lokal<T>> = aktuell.flatMapLatest { b ->
        if (b == null) flowOf(Lokal(emptyList(), null))
        else bestand.beobachte(b, fach.art).map { dekodiere(fach, it) }
    }

    /**
     * Die lokale Liste, nur mit den Zeilen, die [filter] trifft — bei jeder Änderung
     * neu gefragt, damit offline Geändertes auch in einer gefilterten Ansicht erscheint.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T : Any> beobachte(fach: Fach<T>, filter: Filterspalten): Flow<Lokal<T>> =
        if (filter == Filterspalten()) beobachte(fach)
        else beobachte(fach).mapLatest { alle -> if (alle.stand == null) alle else filtere(fach, filter) ?: alle }

    suspend fun <T : Any> lies(fach: Fach<T>): Lokal<T>? {
        val b = bereich() ?: return null
        return dekodiere(fach, bestand.lies(b, fach.art))
    }

    /** Die lokale Liste, nur mit den Zeilen, die [filter] trifft; null, wenn niemand angemeldet ist. */
    suspend fun <T : Any> filtere(fach: Fach<T>, filter: Filterspalten): Lokal<T>? {
        val b = bereich() ?: return null
        return dekodiere(fach, bestand.filtere(b, fach.art, filter))
    }

    /**
     * Antwort des Servers übernehmen. [anhaengen] für weitere Seiten einer
     * blätternden Liste: Geschrieben wird nur die Seite, der Rest der Liste
     * bleibt, wie er ist; doppelte Schlüssel gewinnt die neue Zeile.
     */
    suspend fun <T : Any> uebernimm(fach: Fach<T>, liste: List<T>, anhaengen: Boolean = false, bereich: String? = null) {
        val b = bereich ?: bereich() ?: return
        bestand.raeumeAndere(b)
        val wartend = ausgang.alle(b).map { it.bearbeitung }.filter { it.art == fach.art }
        var zusammen = liste
        for (w in wartend) zusammen = anwenden(fach, zusammen, w)
        if (!anhaengen) return bestand.ersetze(b, fach.art, kodiere(fach, zusammen), uhr())
        // Was erst lokal entsteht, hat Seite 1 schon vorn eingefügt; eine weitere
        // Seite nimmt nur Änderungen an ihren eigenen Zeilen an.
        val seite = liste.mapTo(HashSet()) { fach.schluessel(it) }
        val bleibt = zusammen.filter { fach.schluessel(it) in seite }
        bestand.haengeAn(b, fach.art, kodiere(fach, bleibt), seite - bleibt.mapTo(HashSet()) { fach.schluessel(it) }, uhr())
    }

    /**
     * Wartet für den aktuellen Bereich noch etwas (für [art] oder überhaupt)?
     * Dann muss Neues dahinter, sonst kippt die Reihenfolge.
     */
    suspend fun wartet(art: Bestandsart? = null): Boolean {
        val b = bereich() ?: return false
        return if (art == null) ausgang.erster(b) != null else ausgang.alle(b).any { it.bearbeitung.art == art }
    }

    /**
     * Ein neuer Idempotency-Key. Er entsteht vor dem ersten Versuch, damit ein
     * direkter Versuch und seine Wiederholung aus dem Ausgang denselben tragen.
     */
    fun neuerSchluessel(): String = schluesselQuelle()

    /**
     * Bearbeitung in den Ausgang legen und lokal anwenden. false, wenn niemand
     * angemeldet ist — dann gibt es keinen Ort, dem sie gehört.
     */
    suspend fun puffere(bearbeitung: Bearbeitung, schluessel: String = neuerSchluessel()): Boolean {
        val b = bereich() ?: return false
        ausgang.einreihen(b, bearbeitung, uhr(), schluessel)
        wendeAn(bearbeitung, b)
        runCatching { planer.plane() }
        return true
    }

    /** Eine online gelungene Bearbeitung auch lokal nachziehen, damit die Liste sofort stimmt. */
    suspend fun wendeAn(bearbeitung: Bearbeitung, bereich: String? = null) {
        val b = bereich ?: bereich() ?: return
        when (bearbeitung.art) {
            Bestandsart.SETS -> aendere(Faecher.SETS, b) { LokaleAnwendung.sets(it, bearbeitung) }
            Bestandsart.MERKLISTE -> aendere(Faecher.MERKLISTE, b) { LokaleAnwendung.merkliste(it, bearbeitung) }
            Bestandsart.MANUELLE_TEILE -> aendere(Faecher.MANUELLE_TEILE, b) { LokaleAnwendung.manuelleTeile(it, bearbeitung) }
            Bestandsart.MANUELLE_FIGUREN -> aendere(Faecher.MANUELLE_FIGUREN, b) { LokaleAnwendung.manuelleFiguren(it, bearbeitung) }
            else -> Unit
        }
    }

    /** Einen Eintrag entfernen, den der Server schon gelöscht hat (Löschen geht nur online). */
    suspend fun <T : Any> entferne(fach: Fach<T>, schluessel: String) {
        val b = bereich() ?: return
        aendere(fach, b) { l -> l.filterNot { fach.schluessel(it) == schluessel } }
    }

    /** Senden anstossen, z. B. beim Start, falls vom letzten Mal noch etwas wartet. */
    fun planeSenden() = runCatching { planer.plane() }

    /** Beim Abmelden: Listen und Ausgang aller Bereiche. */
    suspend fun leere() {
        bestand.leere()
        ausgang.leere()
    }

    private suspend fun <T : Any> aendere(fach: Fach<T>, b: String, f: (List<T>) -> List<T>) {
        val alt = dekodiere(fach, bestand.lies(b, fach.art))
        bestand.ersetze(b, fach.art, kodiere(fach, f(alt.liste)), null)
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T : Any> anwenden(fach: Fach<T>, liste: List<T>, b: Bearbeitung): List<T> = when (fach.art) {
        Bestandsart.SETS -> LokaleAnwendung.sets(liste as List<SetItem>, b) as List<T>
        Bestandsart.MERKLISTE -> LokaleAnwendung.merkliste(liste as List<Merkposten>, b) as List<T>
        Bestandsart.MANUELLE_TEILE -> LokaleAnwendung.manuelleTeile(liste as List<PartValuationItem>, b) as List<T>
        Bestandsart.MANUELLE_FIGUREN -> LokaleAnwendung.manuelleFiguren(liste as List<FigValuationItem>, b) as List<T>
        else -> liste
    }

    private fun <T : Any> kodiere(fach: Fach<T>, liste: List<T>) =
        liste.map { LokaleZeile(fach.schluessel(it), AblageJson.encodeToString(fach.serializer, it), fach.spalten(it)) }

    /** Zeilen, die sich nicht mehr lesen lassen (Modell geändert), fallen weg statt die Liste zu sperren. */
    private fun <T : Any> dekodiere(fach: Fach<T>, l: Lokal<LokaleZeile>) =
        Lokal(l.liste.mapNotNull { runCatching { AblageJson.decodeFromString(fach.serializer, it.inhalt) }.getOrNull() }, l.stand)
}
