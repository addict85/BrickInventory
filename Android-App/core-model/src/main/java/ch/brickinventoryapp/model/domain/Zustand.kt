package ch.brickinventoryapp.model.domain

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.InternalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.SerialKind
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.descriptors.buildSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * Condition of an item. On the wire it is called "N" or "U" ([kennung]); in code
 * stands the type, so that no comparison with a letter rebuilds the rule.
 * Unknown reads as [NEU], as in the server (`=== 'U' ? 'U' : 'N'`): a new
 * value shall not discard the whole list.
 */
@Serializable(with = StateSerializer::class)
enum class Zustand(val kennung: String) {
    NEU("N"),
    GEBRAUCHT("U");

    companion object {
        /** null for empty or unknown — the caller decides what applies then. */
        fun aus(kennung: String?): Zustand? = entries.firstOrNull { it.kennung.equals(kennung?.trim(), ignoreCase = true) }
    }
}

/**
 * Writes the [Zustand.kennung]. The descriptor is an enum type under the name
 * of the class, like the generated one: Navigation recognizes a route field as enum by it.
 */
@OptIn(InternalSerializationApi::class, ExperimentalSerializationApi::class)
object StateSerializer : KSerializer<Zustand> {
    override val descriptor: SerialDescriptor =
        buildSerialDescriptor(Zustand::class.java.name, SerialKind.ENUM) {
            Zustand.entries.forEach { element(it.kennung, buildSerialDescriptor(it.kennung, StructureKind.OBJECT)) }
        }

    override fun serialize(encoder: Encoder, value: Zustand) = encoder.encodeString(value.kennung)

    override fun deserialize(decoder: Decoder): Zustand = Zustand.aus(decoder.decodeString()) ?: Zustand.NEU
}
