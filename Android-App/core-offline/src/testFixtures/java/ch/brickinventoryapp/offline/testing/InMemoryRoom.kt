package ch.brickinventoryapp.offline.testing

import android.content.Context
import androidx.room.Room
import ch.brickinventoryapp.offline.LocalInventory
import ch.brickinventoryapp.offline.Outbox
import ch.brickinventoryapp.offline.room.InventoryDatabase
import ch.brickinventoryapp.offline.room.OutboxRow
import ch.brickinventoryapp.offline.room.RoomInventory
import ch.brickinventoryapp.offline.room.RoomOutbox

/**
 * The device's Room store in memory, for tests of the layers above it: they run the
 * real queries without seeing the database, which stays internal to core-offline.
 */
class InMemoryRoom(context: Context) : AutoCloseable {
    private val db = Room.inMemoryDatabaseBuilder(context, InventoryDatabase::class.java).allowMainThreadQueries().build()
    val stock: LocalInventory = RoomInventory(db)
    val outbox: Outbox = RoomOutbox(db)

    /** An outbox row exactly as stored, past the serializer — as an older app version wrote it. */
    suspend fun addRawOutboxRow(area: String, json: String, created: Long, key: String) {
        db.outbox().addOne(OutboxRow(area = area, editing = json, created = created, key = key))
    }

    override fun close() = db.close()
}
