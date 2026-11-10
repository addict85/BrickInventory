package ch.brickinventoryapp.offline.room

import ch.brickinventoryapp.offline.AblageJson
import ch.brickinventoryapp.offline.Ausgang
import ch.brickinventoryapp.offline.Ausgangsposten
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.offline.Bestandsart
import ch.brickinventoryapp.offline.Bestandsfilter
import ch.brickinventoryapp.offline.LokaleListe
import ch.brickinventoryapp.offline.LokaleZeile
import ch.brickinventoryapp.offline.LokalerBestand
import ch.brickinventoryapp.offline.Merkmale
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import javax.inject.Inject

/** [LokalerBestand] über Room: Zeilen und Stand je Bereich und Art. */
internal class RoomBestand @Inject constructor(private val db: BestandDatenbank) : LokalerBestand {
    private val dao get() = db.bestand()

    override fun beobachte(bereich: String, art: Bestandsart): Flow<LokaleListe> =
        combine(dao.beobachte(bereich, art.name), dao.beobachteStand(bereich, art.name)) { zeilen, stand ->
            LokaleListe(zeilen.map { it.alsLokal() }, stand)
        }

    override suspend fun lies(bereich: String, art: Bestandsart) =
        LokaleListe(dao.lies(bereich, art.name).map { it.alsLokal() }, dao.stand(bereich, art.name))

    override suspend fun filtere(bereich: String, art: Bestandsart, filter: Bestandsfilter): LokaleListe {
        val f = filter
        val zeilen = dao.filtere(bereich, art.name, f.suche?.let(::enthaeltMuster), f.thema, f.lagerort, f.farbe,
            f.kategorie, f.ersatzteil, f.zustand)
        return LokaleListe(zeilen.map { it.alsLokal() }, dao.stand(bereich, art.name))
    }

    override suspend fun ersetze(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>, stand: Long?) =
        dao.ersetze(bereich, art.name,
            // Doppelte Schlüssel verletzten den Primärschlüssel; die spätere Zeile gilt.
            zeilen.associateBy { it.schluessel }.values.mapIndexed { i, z -> z.alsZeile(bereich, art, i) },
            stand)

    override suspend fun haengeAn(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>, weg: Set<String>, stand: Long) =
        dao.haengeAn(bereich, art.name, zeilen.associateBy { it.schluessel }.values.map { it.alsZeile(bereich, art, 0) },
            weg.toList(), stand)

    override suspend fun raeumeAndere(bereich: String) {
        dao.loescheAndereZeilen(bereich)
        dao.loescheAndereStaende(bereich)
    }

    override suspend fun leere() {
        dao.leereZeilen()
        dao.leereStaende()
    }
}

private fun BestandZeile.alsLokal() =
    LokaleZeile(schluessel, inhalt, Merkmale(suchtext, thema, lagerort, farbe, kategorie, ersatzteil, zustand))

private fun LokaleZeile.alsZeile(bereich: String, art: Bestandsart, position: Int) = with(merkmale) {
    BestandZeile(bereich, art.name, schluessel, position, inhalt, suchtext, thema, lagerort, farbe, kategorie, ersatzteil, zustand)
}

/** „Enthält“ als LIKE-Muster; `%`, `_` und `\` gelten wörtlich wie beim Server (likeSuche.ts). */
internal fun enthaeltMuster(suche: String): String =
    "%" + suche.lowercase().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"

/**
 * [Ausgang] über Room. Ein Posten, der sich nicht mehr lesen lässt (Format einer
 * älteren App), wird beim Lesen entfernt — er blockierte sonst alles dahinter.
 */
internal class RoomAusgang @Inject constructor(private val db: BestandDatenbank) : Ausgang {
    private val dao get() = db.ausgang()

    override fun anzahl(bereich: String) = dao.anzahl(bereich)

    override suspend fun einreihen(bereich: String, bearbeitung: Bearbeitung, jetzt: Long, schluessel: String) =
        dao.fuegeEin(AusgangZeile(bereich = bereich,
            bearbeitung = AblageJson.encodeToString(Bearbeitung.serializer(), bearbeitung), erstellt = jetzt,
            schluessel = schluessel))

    override suspend fun alle(bereich: String) = dao.alle(bereich).mapNotNull { lies(it) }

    override suspend fun erster(bereich: String): Ausgangsposten? {
        var z = dao.erster(bereich)
        while (z != null) {
            lies(z)?.let { return it }
            z = dao.erster(bereich)
        }
        return null
    }

    override suspend fun entferne(id: Long) = dao.entferne(id)
    override suspend fun versuchGescheitert(id: Long) = dao.versuchGescheitert(id)
    override suspend fun leere() = dao.leere()

    private suspend fun lies(z: AusgangZeile): Ausgangsposten? =
        runCatching { AblageJson.decodeFromString(Bearbeitung.serializer(), z.bearbeitung) }.getOrNull()
            ?.let { Ausgangsposten(z.id, it, z.erstellt, z.versuche, z.schluessel) }
            ?: run { dao.entferne(z.id); null }
}
