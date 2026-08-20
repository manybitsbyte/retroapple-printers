/*
 * printer-ribbon.js - Virtual ink cartridge (ribbon)
 *
 * The fabric ribbon loaded in the carriage. A black ribbon prints everything
 * black no matter what colour the data selects; the four-band colour ribbon
 * (black / yellow / magenta / cyan on the ImageWriter II) honours ESC K colour
 * selection. Swapping the cart is a physical act — future ink lands in the new
 * colour; ink already on the paper is unchanged.
 *
 * Written by
 *  Mike Daley <michael_daley@icloud.com>
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

export class VirtualRibbon {
  constructor(type = "bw") { this.type = type === "color" ? "color" : "bw"; }

  setType(type) { this.type = type === "color" ? "color" : "bw"; }

  // Map a requested colour to the ink the loaded cart can actually deliver.
  ink(color) { return this.type === "color" ? (color || "black") : "black"; }

  isColor() { return this.type === "color"; }
}
