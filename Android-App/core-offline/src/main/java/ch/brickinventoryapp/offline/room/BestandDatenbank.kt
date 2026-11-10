package ch.brickinventoryapp.offline.room

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import ch.brickinventoryapp.offline.Faecher
import kotlinx.coroutines.flow.Flow
import java.util.UUID

/**
 * Eine Zeile einer lokalen Liste: das Server-Modell als JSON ([inhalt]) und
 * daneben die Spalten, nach denen der Server filtert. Ohne Netz beantwortet
 * dieselbe Abfrage hier die Suche; ein neues Anzeigefeld braucht weiter keine
 * Migration, nur ein neuer Filter.
 */
@Entity(tableName = "bestand", primaryKeys = ["bereich", "art", "schluessel"])
internal data class BestandZeile(
    val bereich: String,
    val art: String,
    val schluessel: String,
    val position: Int,
    val inhalt: String,
    @ColumnInfo(defaultValue = "''") val suchtext: String = "",
    val thema: String? = null,
    val lagerort: String? = null,
    val farbe: String? = null,
    val kategorie: String? = null,
    val ersatzteil: Boolean? = null,
    val zustand: String? = null,
)

/** Wann der Server eine Liste zuletzt geliefert hat — für „Offline – Stand von …“. */
@Entity(tableName = "bestand_stand", primaryKeys = ["bereich", "art"])
internal data class BestandStand(val bereich: String, val art: String, val stand: Long)

/**
 * Ein Posten des Ausgangs; [id] steigt und ist die Reihenfolge des Sendens.
 * [schluessel] ist der Idempotency-Key des Postens (seit Fassung 2).
 */
@Entity(tableName = "ausgang", indices = [Index("bereich")])
internal data class AusgangZeile(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val bereich: String,
    val bearbeitung: String,
    val erstellt: Long,
    val versuche: Int = 0,
    @ColumnInfo(defaultValue = "''") val schluessel: String,
)

@Dao
internal abstract class BestandDao {
    @Query("SELECT * FROM bestand WHERE bereich = :bereich AND art = :art ORDER BY position")
    abstract fun beobachte(bereich: String, art: String): Flow<List<BestandZeile>>

    @Query("SELECT * FROM bestand WHERE bereich = :bereich AND art = :art ORDER BY position")
    abstract suspend fun lies(bereich: String, art: String): List<BestandZeile>

    /** Die Filter wie beim Server; ein null-Parameter schränkt nicht ein. [suche] ist ein LIKE-Muster. */
    @Query("""SELECT * FROM bestand WHERE bereich = :bereich AND art = :art
        AND (:suche IS NULL OR suchtext LIKE :suche ESCAPE '\')
        AND (:thema IS NULL OR thema = :thema) AND (:lagerort IS NULL OR lagerort = :lagerort)
        AND (:farbe IS NULL OR farbe = :farbe) AND (:kategorie IS NULL OR kategorie = :kategorie)
        AND (:ersatzteil IS NULL OR ersatzteil = :ersatzteil) AND (:zustand IS NULL OR zustand = :zustand)
        ORDER BY position""")
    abstract suspend fun filtere(
        bereich: String, art: String, suche: String?, thema: String?, lagerort: String?,
        farbe: String?, kategorie: String?, ersatzteil: Boolean?, zustand: String?,
    ): List<BestandZeile>

    @Query("SELECT stand FROM bestand_stand WHERE bereich = :bereich AND art = :art")
    abstract fun beobachteStand(bereich: String, art: String): Flow<Long?>

    @Query("SELECT stand FROM bestand_stand WHERE bereich = :bereich AND art = :art")
    abstract suspend fun stand(bereich: String, art: String): Long?

    @Query("DELETE FROM bestand WHERE bereich = :bereich AND art = :art")
    abstract suspend fun loescheListe(bereich: String, art: String)

    @Insert
    abstract suspend fun fuegeEin(zeilen: List<BestandZeile>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun setzeStand(stand: BestandStand)

    /** Ganz oder gar nicht: Ein Leser sieht nie eine halb ersetzte Liste. */
    @Transaction
    open suspend fun ersetze(bereich: String, art: String, zeilen: List<BestandZeile>, stand: Long?) {
        loescheListe(bereich, art)
        fuegeEin(zeilen)
        if (stand != null) setzeStand(BestandStand(bereich, art, stand))
    }

    @Query("SELECT MAX(position) FROM bestand WHERE bereich = :bereich AND art = :art")
    abstract suspend fun letztePosition(bereich: String, art: String): Int?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun fuegeEinOderErsetze(zeilen: List<BestandZeile>)

    @Query("DELETE FROM bestand WHERE bereich = :bereich AND art = :art AND schluessel IN (:schluessel)")
    abstract suspend fun loescheSchluessel(bereich: String, art: String, schluessel: List<String>)

    /** Eine weitere Seite hinten an: nur ihre Zeilen, die übrigen bleiben unberührt. */
    @Transaction
    open suspend fun haengeAn(bereich: String, art: String, zeilen: List<BestandZeile>, weg: List<String>, stand: Long) {
        if (weg.isNotEmpty()) loescheSchluessel(bereich, art, weg)
        val ab = (letztePosition(bereich, art) ?: -1) + 1
        fuegeEinOderErsetze(zeilen.mapIndexed { i, z -> z.copy(position = ab + i) })
        setzeStand(BestandStand(bereich, art, stand))
    }

    @Query("DELETE FROM bestand WHERE bereich != :bereich")
    abstract suspend fun loescheAndereZeilen(bereich: String)

    @Query("DELETE FROM bestand_stand WHERE bereich != :bereich")
    abstract suspend fun loescheAndereStaende(bereich: String)

    @Query("DELETE FROM bestand")
    abstract suspend fun leereZeilen()

    @Query("DELETE FROM bestand_stand")
    abstract suspend fun leereStaende()
}

@Dao
internal interface AusgangDao {
    @Query("SELECT COUNT(*) FROM ausgang WHERE bereich = :bereich")
    fun anzahl(bereich: String): Flow<Int>

    @Insert
    suspend fun fuegeEin(zeile: AusgangZeile): Long

    @Query("SELECT * FROM ausgang WHERE bereich = :bereich ORDER BY id")
    suspend fun alle(bereich: String): List<AusgangZeile>

    @Query("SELECT * FROM ausgang WHERE bereich = :bereich ORDER BY id LIMIT 1")
    suspend fun erster(bereich: String): AusgangZeile?

    @Query("DELETE FROM ausgang WHERE id = :id")
    suspend fun entferne(id: Long)

    @Query("UPDATE ausgang SET versuche = versuche + 1 WHERE id = :id")
    suspend fun versuchGescheitert(id: Long)

    @Query("DELETE FROM ausgang")
    suspend fun leere()
}

/**
 * Wer das Schema ändert, erhöht die Fassung, schreibt eine Migration und checkt
 * das Schema aus app/schemas ein: Der Ausgang trägt Änderungen, die es nur hier
 * gibt — ein destruktiver Neuanfang verlöre sie.
 */
@Database(entities = [BestandZeile::class, BestandStand::class, AusgangZeile::class], version = 3, exportSchema = true)
internal abstract class BestandDatenbank : RoomDatabase() {
    abstract fun bestand(): BestandDao
    abstract fun ausgang(): AusgangDao

    companion object {
        const val NAME = "bestand.db"

        /** Alle Migrationen, in der Reihenfolge der Fassungen. */
        val MIGRATIONEN: Array<Migration> = arrayOf(MIGRATION_1_2, MIGRATION_2_3)
    }
}

/**
 * 1 → 2: Jeder wartende Posten bekommt seinen Idempotency-Key. Einer, der vor
 * dem Update schon einmal gesendet wurde, trug keinen; ab jetzt hat er einen
 * festen, damit seine weiteren Versuche beim Server nur einmal wirken.
 */
internal val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `ausgang` ADD COLUMN `schluessel` TEXT NOT NULL DEFAULT ''")
        val ids = mutableListOf<Long>()
        db.query("SELECT id FROM `ausgang`").use { c -> while (c.moveToNext()) ids += c.getLong(0) }
        for (id in ids) db.execSQL("UPDATE `ausgang` SET `schluessel` = ? WHERE id = ?", arrayOf<Any>(UUID.randomUUID().toString(), id))
    }
}

/**
 * 2 → 3: Filterspalten. Die abgelegten Listen bleiben und bekommen ihre Werte
 * aus dem JSON daneben — sonst fände die Suche ohne Netz bis zum nächsten
 * Abgleich nichts. Eine Zeile, die sich nicht mehr lesen lässt, fiele beim
 * Lesen ohnehin weg; hier geht sie gleich.
 */
internal val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `bestand` ADD COLUMN `suchtext` TEXT NOT NULL DEFAULT ''")
        for (spalte in listOf("thema", "lagerort", "farbe", "kategorie")) db.execSQL("ALTER TABLE `bestand` ADD COLUMN `$spalte` TEXT")
        db.execSQL("ALTER TABLE `bestand` ADD COLUMN `ersatzteil` INTEGER")
        db.execSQL("ALTER TABLE `bestand` ADD COLUMN `zustand` TEXT")
        val zeilen = mutableListOf<Array<String>>()
        db.query("SELECT bereich, art, schluessel, inhalt FROM `bestand`").use { c ->
            while (c.moveToNext()) zeilen += Array(4) { c.getString(it) }
        }
        for ((bereich, art, schluessel, inhalt) in zeilen) {
            val schranke = arrayOf<Any?>(bereich, art, schluessel)
            val m = Faecher.spaltenAus(art, inhalt)
            if (m == null) db.execSQL("DELETE FROM `bestand` WHERE bereich = ? AND art = ? AND schluessel = ?", schranke)
            else db.execSQL("UPDATE `bestand` SET suchtext = ?, thema = ?, lagerort = ?, farbe = ?, kategorie = ?, " +
                "ersatzteil = ?, zustand = ? WHERE bereich = ? AND art = ? AND schluessel = ?",
                arrayOf<Any?>(m.suchtext.orEmpty(), m.thema, m.lagerort, m.farbe, m.kategorie, m.ersatzteil?.let { if (it) 1 else 0 },
                    m.zustand, *schranke))
        }
    }
}
