package ch.brickinventoryapp.data.lokal

import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.cache.CacheBesitzer
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.FigValuationItem
import ch.brickinventoryapp.data.model.Gutschein
import ch.brickinventoryapp.data.model.Merkposten
import ch.brickinventoryapp.data.model.Minifig
import ch.brickinventoryapp.data.model.Part
import ch.brickinventoryapp.data.model.PartValuationItem
import ch.brickinventoryapp.data.model.SetItem
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import javax.inject.Inject
import javax.inject.Singleton

/** Eine lokale Liste mit Typ, Schlüssel und Serializer. */
class Fach<T : Any>(val art: Bestandsart, val serializer: KSerializer<T>, val schluessel: (T) -> String)

object Faecher {
    val SETS = Fach(Bestandsart.SETS, SetItem.serializer()) { it.setNumber }
    val MERKLISTE = Fach(Bestandsart.MERKLISTE, Merkposten.serializer()) { LokaleAnwendung.merkSchluessel(it) }
    val TEILE = Fach(Bestandsart.TEILE, Part.serializer()) { "${it.partNumber}|${it.colorId}|${it.isSpare}" }
    val FIGUREN = Fach(Bestandsart.FIGUREN, Minifig.serializer()) { it.figNumber }
    val MANUELLE_TEILE = Fach(Bestandsart.MANUELLE_TEILE, PartValuationItem.serializer()) {
        "${it.partNumber}|${it.colorId}|${it.userId}"
    }
    val MANUELLE_FIGUREN = Fach(Bestandsart.MANUELLE_FIGUREN, FigValuationItem.serializer()) { "${it.figNumber}|${it.userId}" }
    val GUTSCHEINE = Fach(Bestandsart.GUTSCHEINE, Gutschein.serializer()) { it.id.toString() }
}

/** Was lokal liegt; [stand] ist der Zeitpunkt der letzten Serverantwort, null = nie geladen. */
data class Lokal<T>(val liste: List<T>, val stand: Long?)

/** Was beim Abgleich geschah — die Oberfläche lädt nach oder zeigt einen Hinweis. */
sealed class Abgleichsereignis {
    data class Gesendet(val arten: Set<Bestandsart>) : Abgleichsereignis()
    data class Verworfen(val bearbeitung: Bearbeitung, val meldung: String, val httpCode: Int?) : Abgleichsereignis()
}

/** Plant das Senden des Ausgangs; im Gerät über WorkManager (AusgangWorker). */
fun interface AusgangPlaner {
    fun plane()
}

/**
 * Die lokale Wahrheit der Oberfläche: Listen und Ausgang je Bereich (Server und
 * Konto). Der Server bleibt massgeblich — was er liefert, ersetzt die Liste;
 * noch nicht gesendete Bearbeitungen werden danach wieder darübergelegt, damit
 * sie nicht kurz verschwinden, bis der Ausgang leer ist.
 */
@Singleton
class Offlineablage(
    private val bestand: LokalerBestand,
    internal val ausgang: Ausgang,
    private val bereichQuelle: suspend () -> String?,
    private val planer: AusgangPlaner = AusgangPlaner {},
    private val uhr: () -> Long = System::currentTimeMillis,
) {
    @Inject constructor(bestand: LokalerBestand, ausgang: Ausgang, besitzer: CacheBesitzer, planer: AusgangPlaner) :
        this(bestand, ausgang, bereichQuelle = { besitzer.kontoBereich()?.let { ResponseCache.bereichsName(it) } }, planer = planer)

    private val aktuell = MutableStateFlow<String?>(null)
    private val _ereignisse = MutableSharedFlow<Abgleichsereignis>(extraBufferCapacity = 16)
    val ereignisse: SharedFlow<Abgleichsereignis> = _ereignisse.asSharedFlow()

    /** Der gültige Bereich, gestreut; null = nicht angemeldet, dann wird nichts abgelegt. */
    suspend fun bereich(): String? =
        runCatching { bereichQuelle() }.getOrNull()?.takeIf { it.isNotBlank() }.also { aktuell.value = it }

    /** Wie viele Bearbeitungen noch auf den Server warten. */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun offene(): Flow<Int> = aktuell.flatMapLatest { b -> if (b == null) flowOf(0) else ausgang.anzahl(b) }

    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T : Any> beobachte(fach: Fach<T>): Flow<Lokal<T>> = aktuell.flatMapLatest { b ->
        if (b == null) flowOf(Lokal(emptyList(), null))
        else bestand.beobachte(b, fach.art).map { dekodiere(fach, it) }
    }

    suspend fun <T : Any> lies(fach: Fach<T>): Lokal<T>? {
        val b = bereich() ?: return null
        return dekodiere(fach, bestand.lies(b, fach.art))
    }

    /**
     * Antwort des Servers übernehmen. [anhaengen] für weitere Seiten einer
     * blätternden Liste; doppelte Schlüssel gewinnt die neue Zeile.
     */
    suspend fun <T : Any> uebernimm(fach: Fach<T>, liste: List<T>, anhaengen: Boolean = false, bereich: String? = null) {
        val b = bereich ?: bereich() ?: return
        bestand.raeumeAndere(b)
        val basis = if (anhaengen) dekodiere(fach, bestand.lies(b, fach.art)).liste else emptyList()
        val neueSchluessel = liste.mapTo(HashSet()) { fach.schluessel(it) }
        var zusammen = basis.filterNot { fach.schluessel(it) in neueSchluessel } + liste
        for (p in ausgang.alle(b)) if (p.bearbeitung.art == fach.art) zusammen = anwenden(fach, zusammen, p.bearbeitung)
        bestand.ersetze(b, fach.art, kodiere(fach, zusammen), uhr())
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
     * Bearbeitung in den Ausgang legen und lokal anwenden. false, wenn niemand
     * angemeldet ist — dann gibt es keinen Ort, dem sie gehört.
     */
    suspend fun puffere(bearbeitung: Bearbeitung): Boolean {
        val b = bereich() ?: return false
        ausgang.einreihen(b, bearbeitung, uhr())
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

    internal fun melde(e: Abgleichsereignis) { _ereignisse.tryEmit(e) }

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
        liste.map { LokaleZeile(fach.schluessel(it), ApiJson.encodeToString(fach.serializer, it)) }

    /** Zeilen, die sich nicht mehr lesen lassen (Modell geändert), fallen weg statt die Liste zu sperren. */
    private fun <T : Any> dekodiere(fach: Fach<T>, l: LokaleListe) =
        Lokal(l.zeilen.mapNotNull { runCatching { ApiJson.decodeFromString(fach.serializer, it.inhalt) }.getOrNull() }, l.stand)

    companion object {
        /** Im Speicher, mit festem Bereich — für Tests und Repositories ohne Hilt. */
        fun fluechtig(bereich: String? = "test", planer: AusgangPlaner = AusgangPlaner {}) =
            Offlineablage(SpeicherBestand(), SpeicherAusgang(), { bereich }, planer)
    }
}
