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
import ch.brickinventoryapp.model.data.model.AddSetRequest
import ch.brickinventoryapp.model.data.model.SetAggregate
import ch.brickinventoryapp.model.fach.Zustand
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.KSerializer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Eine lokale Liste mit Typ, Schlüssel, Serializer, den Spalten, nach denen sie
 * gefiltert wird, und wie eine [Offlineablage.Wirkung] sie ändert — je Fach getypt, damit die
 * Ablage nichts umwandeln muss.
 */
class Fach<T : Any>(
    val art: Bestandsart,
    val serializer: KSerializer<T>,
    val schluessel: (T) -> String,
    val anwenden: (List<T>, Offlineablage.Wirkung) -> List<T> = { l, _ -> l },
    val spalten: (T) -> Filterspalten = { Filterspalten() },
)

object Faecher {
    val SETS = Fach(Bestandsart.SETS, SetItem.serializer(), { it.setNumber }, LokaleAnwendung::sets) {
        // Wie der Server: Nummer, Name, Thema und Jahr (ohne Jahr „0“).
        Filterspalten(suchtext(it.setNumber, it.name, it.theme.orEmpty(), (it.year ?: 0).toString()),
            thema = it.theme, lagerort = it.storage)
    }
    val MERKLISTE = Fach(Bestandsart.MERKLISTE, Merkposten.serializer(), { LokaleAnwendung.merkSchluessel(it) },
        LokaleAnwendung::merkliste) {
        Filterspalten(suchtext(it.setNumber, it.name), zustand = it.condition.kennung)
    }
    val TEILE = Fach(Bestandsart.TEILE, Part.serializer(), { "${it.partNumber}|${it.colorId}|${it.isSpare}" }, spalten = {
        Filterspalten(suchtext(it.partNumber, it.partName, it.blPartNumber), farbe = it.colorName,
            kategorie = it.categoryName, ersatzteil = it.isSpare)
    })
    val FIGUREN = Fach(Bestandsart.FIGUREN, Minifig.serializer(), { it.figNumber }, spalten = {
        Filterspalten(suchtext(it.figNumber, it.figName))
    })
    val MANUELLE_TEILE = Fach(Bestandsart.MANUELLE_TEILE, PartValuationItem.serializer(),
        { "${it.partNumber}|${it.colorId}|${it.userId}" }, LokaleAnwendung::manuelleTeile) {
        Filterspalten(suchtext(it.partNumber, it.partName, it.blPartNumber), lagerort = it.storage)
    }
    val MANUELLE_FIGUREN = Fach(Bestandsart.MANUELLE_FIGUREN, FigValuationItem.serializer(),
        { "${it.figNumber}|${it.userId}" }, LokaleAnwendung::manuelleFiguren) {
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
    /** Der Bereich, wie er jetzt gilt: zum Schreiben und für den Vergleich vor und nach einem Abruf. */
    private val bereichQuelle: suspend () -> String?,
    private val planer: AusgangPlaner = AusgangPlaner {},
    private val uhr: () -> Long = System::currentTimeMillis,
    private val schluesselQuelle: () -> String = { UUID.randomUUID().toString() },
    /**
     * Derselbe Bereich als Fluss, zum Beobachten. Im Gerät ein StateFlow der
     * Sitzung; ohne ihn fragt jedes neue Beobachten die Quelle einmal.
     */
    bereichFluss: Flow<String?> = flow { emit(bereichQuelle()) },
) {
    /**
     * Was ein Schreibvorgang an den lokalen Listen ändert. Zwei Arten, damit der Typ
     * sagt, was in den Ausgang darf: [Bearbeitung] wartet ohne Netz und wird
     * nachgesendet; [Nachzug] gibt es nur online und zieht nur die Ablage nach.
     */
    sealed interface Wirkung {
        /** Die Listen, die sich ändern. */
        val arten: Set<Bestandsart>
    }

    /**
     * Eine Änderung, die ohne Verbindung im Ausgang wartet. Sie trägt genau die
     * Anfrage, die online gegangen wäre — beim Senden entsteht nichts Neues, und
     * der Server entscheidet wie sonst auch. Mengen von Sets gehen als Schritt,
     * damit zwei Geräte, die offline je +1 tippen, zusammen +2 ergeben.
     */

    /**
     * Das Ergebnis eines Schreibvorgangs, der nur online geht, für die lokale Liste.
     * Ohne Ausgang: Was der Server dazu rechnet, bringt der nächste Abgleich.
     */
    sealed interface Nachzug : Wirkung {
        data class SetMengeGesetzt(val setNumber: String, val menge: Int) : Nachzug {
            override val arten get() = setOf(Bestandsart.SETS)
        }

        data class SetLagerort(val setNumber: String, val ort: String?) : Nachzug {
            override val arten get() = setOf(Bestandsart.SETS)
        }

        data class SetEntfernt(val setNumber: String) : Nachzug {
            override val arten get() = setOf(Bestandsart.SETS)
        }

        /** [alle]: Alle Käufe wandern, der alte Besitzer verschwindet von der Kachel. */
        data class SetVerschoben(val setNumber: String, val von: Int?, val zu: Int, val alle: Boolean) : Nachzug {
            override val arten get() = setOf(Bestandsart.SETS)
        }

        /** Ein geänderter Kauf: Der Server schickt die neue Zusammenfassung des Sets mit. */
        data class SetZusammenfassung(val agg: SetAggregate) : Nachzug {
            override val arten get() = setOf(Bestandsart.SETS)
        }

        data class MerkpostenVerschoben(val setNumber: String, val zustand: Zustand, val von: Int, val zu: Int) : Nachzug {
            override val arten get() = setOf(Bestandsart.MERKLISTE)
        }

        /** Der Merkposten geht in die Sammlung: weg aus der Merkliste, dazu in der Galerie. */
        data class MerkpostenUebernommen(val setNumber: String, val zustand: Zustand, val besitzer: Int?,
                                         val anfrage: AddSetRequest) : Nachzug {
            override val arten get() = setOf(Bestandsart.MERKLISTE, Bestandsart.SETS)
        }

        data class TeilLagerort(val partNumber: String, val colorId: Int, val ort: String?) : Nachzug {
            override val arten get() = setOf(Bestandsart.MANUELLE_TEILE)
        }

        /** Die Farbe ist Teil des Schlüssels: Trifft sie eine vorhandene Zeile, legt der Server beide zusammen. */
        data class TeilFarbe(val partNumber: String, val colorId: Int, val neueFarbe: Int, val farbName: String?,
                             val farbHex: String?, val besitzer: Int?) : Nachzug {
            override val arten get() = setOf(Bestandsart.MANUELLE_TEILE)
        }

        data class FigurLagerort(val figNumber: String, val ort: String?) : Nachzug {
            override val arten get() = setOf(Bestandsart.MANUELLE_FIGUREN)
        }

        /** Ein umbenannter Ort heisst überall neu, wo er stand. */
        data class LagerortUmbenannt(val alt: String, val neu: String) : Nachzug {
            override val arten get() = setOf(Bestandsart.SETS, Bestandsart.MANUELLE_TEILE, Bestandsart.MANUELLE_FIGUREN)
        }
    }

    private val aktuell: Flow<String?> = bereichFluss.map { gueltig(it) }.distinctUntilChanged()

    /**
     * Eine Sperre je Bereich und Liste: Lesen, Ändern und Schreiben einer Liste
     * dürfen sich nicht überholen, sonst überschreibt das spätere Schreiben das
     * frühere (verlorene Änderung).
     */
    private val sperren = ConcurrentHashMap<Pair<String, Bestandsart>, Mutex>()

    private fun sperre(b: String, art: Bestandsart) = sperren.getOrPut(b to art) { Mutex() }

    /** Der gültige Bereich, gestreut; null = nicht angemeldet, dann wird nichts abgelegt. */
    suspend fun bereich(): String? = gueltig(fangeAusserAbbruch { bereichQuelle() }.getOrNull())

    private fun gueltig(b: String?) = b?.takeIf { it.isNotBlank() }

    /** Wie viele Bearbeitungen noch auf den Server warten. */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun offene(): Flow<Int> = aktuell.flatMapLatest { b -> if (b == null) flowOf(0) else ausgang.anzahl(b) }

    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T : Any> beobachte(fach: Fach<T>): Flow<Lokal<T>> = aktuell.flatMapLatest { b ->
        if (b == null) flowOf(Lokal(emptyList(), null))
        else bestand.beobachte(b, fach.art).map { dekodiere(fach, it) }
    }

    /**
     * Jede spätere Änderung an einer der [faecher] — für Kennzahlen, die der
     * Server über diese Listen rechnet. Die Ablage ist die Quelle: Was sie nicht
     * ändert, löst nichts aus.
     */
    fun veraendert(vararg faecher: Fach<*>): Flow<Unit> =
        merge(*faecher.map { f -> beobachte(f).map { it.liste }.distinctUntilChanged().drop(1).map { } }.toTypedArray())

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
        // Unter der Sperre: Ein puffere() zwischen dem Lesen des Ausgangs und dem
        // Schreiben ginge sonst mit der Serverliste verloren.
        sperre(b, fach.art).withLock { uebernimmGesperrt(fach, liste, anhaengen, b) }
    }

    private suspend fun <T : Any> uebernimmGesperrt(fach: Fach<T>, liste: List<T>, anhaengen: Boolean, b: String) {
        val wartend = ausgang.alle(b).map { it.bearbeitung }.filter { it.art == fach.art }
        var zusammen = liste
        for (w in wartend) zusammen = fach.anwenden(zusammen, w)
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
        // Einreihen und Anwenden in einem Zug: uebernimm() sieht beides oder keines.
        sperre(b, bearbeitung.art).withLock {
            ausgang.einreihen(b, bearbeitung, uhr(), schluessel)
            wendeAnGesperrt(bearbeitung.art, bearbeitung, b)
        }
        runCatching { planer.plane() }
        return true
    }

    /** Was online gelang, auch lokal anwenden, damit die Liste sofort stimmt. */
    suspend fun wendeAn(wirkung: Wirkung, bereich: String? = null) {
        val b = bereich ?: bereich() ?: return
        // Je Liste nacheinander, nie zwei Sperren zugleich: So kann sich nichts verklemmen.
        for (art in wirkung.arten) sperre(b, art).withLock { wendeAnGesperrt(art, wirkung, b) }
    }

    private suspend fun wendeAnGesperrt(art: Bestandsart, w: Wirkung, b: String) = when (art) {
        Bestandsart.SETS -> aendere(Faecher.SETS, b, w)
        Bestandsart.MERKLISTE -> aendere(Faecher.MERKLISTE, b, w)
        Bestandsart.MANUELLE_TEILE -> aendere(Faecher.MANUELLE_TEILE, b, w)
        Bestandsart.MANUELLE_FIGUREN -> aendere(Faecher.MANUELLE_FIGUREN, b, w)
        // Nur vom Server geliefert, nie lokal bearbeitet.
        Bestandsart.TEILE, Bestandsart.FIGUREN, Bestandsart.GUTSCHEINE -> Unit
    }

    /** Senden anstossen, z. B. beim Start, falls vom letzten Mal noch etwas wartet. */
    fun planeSenden() = runCatching { planer.plane() }

    /** Beim Abmelden: Listen und Ausgang aller Bereiche. */
    suspend fun leere() {
        bestand.leere()
        ausgang.leere()
    }

    /** Nur unter der Sperre von ([b], fach.art) aufrufen. */
    private suspend fun <T : Any> aendere(fach: Fach<T>, b: String, w: Wirkung) {
        val alt = dekodiere(fach, bestand.lies(b, fach.art))
        bestand.ersetze(b, fach.art, kodiere(fach, fach.anwenden(alt.liste, w)), null)
    }

    private fun <T : Any> kodiere(fach: Fach<T>, liste: List<T>) =
        liste.map { LokaleZeile(fach.schluessel(it), AblageJson.encodeToString(fach.serializer, it), fach.spalten(it)) }

    /** Zeilen, die sich nicht mehr lesen lassen (Modell geändert), fallen weg statt die Liste zu sperren. */
    private fun <T : Any> dekodiere(fach: Fach<T>, l: Lokal<LokaleZeile>) =
        Lokal(l.liste.mapNotNull { runCatching { AblageJson.decodeFromString(fach.serializer, it.inhalt) }.getOrNull() }, l.stand)
}
