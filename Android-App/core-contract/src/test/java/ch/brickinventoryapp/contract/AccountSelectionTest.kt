package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.AccountSelection
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Account choice and alarm direction as domain types: what the filter saved becomes
 * the choice and again the value for `accounts=`; the direction reads and writes the
 * server's words.
 *
 * Counter-checks (counter-checks/account-picker-account-wrong.patch, alarm-direction-above-wrong.patch):
 *   Account.request with prefix „konto“ → red “every saved choice becomes the same value again”
 *   UEBER with the identifier „über“ → red “the direction reads and writes the server's words”
 */
class AccountSelectionTest {

    @Test
    fun `every saved choice becomes the same value again`() {
        assertEquals(AccountSelection.Own, AccountSelection.from("own"))
        assertEquals(AccountSelection.SubAccounts, AccountSelection.from("subs"))
        assertEquals(AccountSelection.Account(7), AccountSelection.from(" 7 "))
        assertEquals(listOf("own", "subs", "7"), listOf("own", "subs", "7").map { AccountSelection.from(it)?.request })
    }

    @Test
    fun `all, empty and unreadable do not filter`() {
        assertNull(AccountSelection.from("all"))
        assertNull(AccountSelection.from(""))
        assertNull(AccountSelection.from(null))
        assertNull(AccountSelection.from("lea"))
    }

    @Test
    fun `the direction reads and writes the server's words`() {
        val json = Json { ignoreUnknownKeys = true }
        val alarm = json.decodeFromString(PriceAlert.serializer(), """{"set_number":"1-1","direction":"above","threshold":5.0}""")
        assertEquals(AlarmDirection.OVER, alarm.direction)
        assertEquals("""{"direction":"above","threshold":5.0,"condition":"U"}""",
            Json.encodeToString(PriceAlertRequest.serializer(), PriceAlertRequest(direction = AlarmDirection.OVER, threshold = 5.0, condition = Condition.USED)))
        // Unknown as at the server: „unter“, instead of discarding the list.
        assertEquals(AlarmDirection.BELOW, json.decodeFromString(PriceAlert.serializer(), """{"direction":"seitwaerts"}""").direction)
    }
}
