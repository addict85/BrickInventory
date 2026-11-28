package ch.brickinventoryapp.ui.components

import androidx.compose.runtime.staticCompositionLocalOf
import ch.brickinventoryapp.model.address.AddressRules

/**
 * The address rules for screens that check a server address or open a link. No default:
 * a screen without them must fail loudly, not let every address through or silently block
 * every link. MainActivity provides them, tests their own.
 */
val LocalAddressRules = staticCompositionLocalOf<AddressRules> { error("LocalAddressRules not provided") }
