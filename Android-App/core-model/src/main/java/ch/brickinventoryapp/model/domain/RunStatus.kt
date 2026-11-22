package ch.brickinventoryapp.model.domain

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * The state of a run at the server (CSV import, background jobs of the monitoring). On
 * the wire the [identifier]; a value this version does not know reads as
 * [UNKNOWN] and counts neither as running nor as finished.
 */
@Serializable(with = RunStatusSerializer::class)
enum class RunStatus(val identifier: String) {
    IDLE("idle"),
    WAITING("pending"),
    RUNNING("running"),
    DONE("done"),
    ERROR("error"),
    CANCELLED("cancelled"),
    UNKNOWN("");

    /** `pending` counts too: the job is accepted, the display shall already stand. */
    val running: Boolean get() = this == RUNNING || this == WAITING

    companion object {
        fun from(identifier: String?): RunStatus = entries.firstOrNull { it != UNKNOWN && it.identifier == identifier } ?: UNKNOWN
    }
}

object RunStatusSerializer : KSerializer<RunStatus> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor(RunStatus::class.java.name, PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: RunStatus) = encoder.encodeString(value.identifier)
    override fun deserialize(decoder: Decoder): RunStatus = RunStatus.from(decoder.decodeString())
}
