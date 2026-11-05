package ch.brickinventoryapp.data.lokal.room

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow
import java.util.UUID

/**
 * Eine Zeile einer lokalen Liste. [inhalt] ist das Server-Modell als JSON:
 * Gefiltert und sortiert wird auf dem Server, lokal zählen nur Bereich, Art,
 * Schlüssel und Reihenfolge. So braucht ein neues Feld des Servers keine Migration.
 */
@Entity(tableName = "bestand", primaryKeys = ["bereich", "art", "schluessel"])
data class BestandZeile(
    val bereich: String,
    val art: String,
    val schluessel: String,
    val position: Int,
    val inhalt: String,
)

/** Wann der Server eine Liste zuletzt geliefert hat — für „Offline – Stand von …“. */
@Entity(tableName = "bestand_stand", primaryKeys = ["bereich", "art"])
data class BestandStand(val bereich: String, val art: String, val stand: Long)

/**
 * Ein Posten des Ausgangs; [id] steigt und ist die Reihenfolge des Sendens.
 * [schluessel] ist der Idempotency-Key des Postens (seit Fassung 2).
 */
@Entity(tableName = "ausgang", indices = [Index("bereich")])
data class AusgangZeile(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val bereich: String,
    val bearbeitung: String,
    val erstellt: Long,
    val versuche: Int = 0,
    @ColumnInfo(defaultValue = "''") val schluessel: String,
)

@Dao
abstract class BestandDao {
    @Query("SELECT * FROM bestand WHERE bereich = :bereich AND art = :art ORDER BY position")
    abstract fun beobachte(bereich: String, art: String): Flow<List<BestandZeile>>

    @Query("SELECT * FROM bestand WHERE bereich = :bereich AND art = :art ORDER BY position")
    abstract suspend fun lies(bereich: String, art: String): List<BestandZeile>

    @Query("SELECT stand FROM bestand_stand WHERE bereich = :bereich AND art = :art")
    abstract fun beobachteStand(bereich: String, art: String): Flow<Long?>

    @Query("SELECT stand FROM bestand_stand WHERE bereich = :bereich AND art = :art")
    abstract suspend fun stand(bereich: String, art: String): Long?

    @Query("DELETE FROM bestand WHERE bereich = :bereich AND art = :art")
    abstract suspend fun loescheListe(bereich: String, art: String)

    @Insert
    abstract suspend fun fuegeEin(zeilen: List<BestandZeile>)

    @Insert(onConflict = androidx.room.OnConflictStrategy.REPLACE)
    abstract suspend fun setzeStand(stand: BestandStand)

    /** Ganz oder gar nicht: Ein Leser sieht nie eine halb ersetzte Liste. */
    @Transaction
    open suspend fun ersetze(bereich: String, art: String, zeilen: List<BestandZeile>, stand: Long?) {
        loescheListe(bereich, art)
        fuegeEin(zeilen)
        if (stand != null) setzeStand(BestandStand(bereich, art, stand))
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
interface AusgangDao {
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
@Database(entities = [BestandZeile::class, BestandStand::class, AusgangZeile::class], version = 2, exportSchema = true)
abstract class BestandDatenbank : RoomDatabase() {
    abstract fun bestand(): BestandDao
    abstract fun ausgang(): AusgangDao

    companion object {
        const val NAME = "bestand.db"

        /** Alle Migrationen, in der Reihenfolge der Fassungen. */
        val MIGRATIONEN: Array<Migration> = arrayOf(MIGRATION_1_2)
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
