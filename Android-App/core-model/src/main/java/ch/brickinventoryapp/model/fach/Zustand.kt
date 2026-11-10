package ch.brickinventoryapp.model.fach

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
 * Zustand eines Postens. Auf der Leitung heisst er "N" oder "U" ([kennung]); im Code
 * steht der Typ, damit kein Vergleich mit einem Buchstaben die Regel nachbaut.
 * Unbekanntes liest sich als [NEU], wie im Server (`=== 'U' ? 'U' : 'N'`): Ein neuer
 * Wert soll nicht die ganze Liste verwerfen.
 */
@Serializable(with = ZustandSerializer::class)
enum class Zustand(val kennung: String) {
    NEU("N"),
    GEBRAUCHT("U");

    companion object {
        /** null für leer oder unbekannt — der Aufrufer entscheidet, was dann gilt. */
        fun aus(kennung: String?): Zustand? = entries.firstOrNull { it.kennung.equals(kennung?.trim(), ignoreCase = true) }
    }
}

/**
 * Schreibt die [Zustand.kennung]. Der Deskriptor ist ein Aufzählungstyp unter dem Namen
 * der Klasse, wie der erzeugte: Navigation erkennt daran ein Routenfeld als Enum.
 */
@OptIn(InternalSerializationApi::class, ExperimentalSerializationApi::class)
object ZustandSerializer : KSerializer<Zustand> {
    override val descriptor: SerialDescriptor =
        buildSerialDescriptor(Zustand::class.java.name, SerialKind.ENUM) {
            Zustand.entries.forEach { element(it.kennung, buildSerialDescriptor(it.kennung, StructureKind.OBJECT)) }
        }

    override fun serialize(encoder: Encoder, value: Zustand) = encoder.encodeString(value.kennung)

    override fun deserialize(decoder: Decoder): Zustand = Zustand.aus(decoder.decodeString()) ?: Zustand.NEU
}
