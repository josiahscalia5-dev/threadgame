/* Wishweave Wonders — how the six painted scenes sit in one connected 3D world (WW.WORLD_LAYOUT).

   Each painting is treated as a photograph taken by a level-roll camera (vertical field of view `vfov`, image
   841 × 1870). Purl's route data already records his on-screen width w at every point of every painting, and his
   real width is fixed (1 world unit = Purl's width), so w gives the distance of every route point from that
   painting's camera. On flat floors the image row y is then linear in w (y = horizon + height · w); fitting that
   line to each scene's flat floor gives its camera's horizon row and height (see tools/ notes in the commit).

     horizon  image row where a flat floor would meet the horizon
     height   camera height in Purl widths divided by cos(pitch) (the slope of y against w)
     edges    for each control point of Purl's path (WW.PLATES[id].purl.path): the image x of the carpet's left and
              right edge on that row, read from the painting (where the walkable carpet surface ends)
     backdrop distance (Purl widths, along the camera's view) of the surface that carries the rest of the
              painting (towers, city, sky)
     wall     height (Purl widths) of the low walls along the carpet edges that carry painted rails and posts

   connectors  the real road that joins one scene's exit to the next scene's entrance: it leaves the exit along
               the painted road's own direction, turns (`turn` degrees, + = right, on a `radius`), then runs
               `straight` widths into the next scene's entrance while rising or falling by `rise` widths. The next
               scene is placed in the world where that road arrives. */
(function (WW) {
  'use strict';
  WW.WORLD_LAYOUT = {
    vfov: 50,
    imageW: 841, imageH: 1870,
    areas: {
      p01: {
        horizon: 653, height: 3.0, backdrop: 27, wall: 0.55,      // the ribbon floats: only its braid edge
        edges: [[60, 560], [150, 480], [150, 490], [262, 352], [240, 380], [90, 310], [65, 245], [120, 240],
                [205, 275], [235, 420], [240, 465], [240, 470], [250, 480]]
      },
      p02: {
        horizon: 595, height: 3.23, backdrop: 24, wall: 1.3,
        edges: [[20, 700], [30, 700], [110, 670], [165, 640], [222, 600], [290, 566], [315, 555], [330, 550]]
      }
    },
    connectors: {
      // round the ribbon's top curl to the right, then down a ramp onto the shortcut's broad landing
      'c-ribbon': { turn: 72, radius: 4.5, straight: 9, rise: -2.6, width: 2.1 }
    }
  };
})(globalThis.WW = globalThis.WW || {});
