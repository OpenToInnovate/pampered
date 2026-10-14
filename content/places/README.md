# Curated and manually added venues.
#
# The OpenStreetMap import covers what mappers have recorded. This directory
# covers the rest: places we have checked by hand, and places OpenStreetMap has
# never heard of. As the directory grows this is the file that matters, and it
# is the one openclaw will edit most.
#
# Rules, all enforced by `npm run check`:
#   id        unique, lowercase, hyphenated. "the-dog-and-duck", not "The Dog & Duck".
#   lat / lon WGS84 decimal degrees. No geocoding, no addresses as coordinates.
#   selections ids that exist in content/selections.yaml. A typo here is a build
#             failure rather than a venue that silently never appears.
#   source    "curated" means we have checked it. "manual" means somebody told
#             us about it and we have not been yet. The two are shown differently
#             and we are not allowed to call a manual row verified.
#
# See AGENTS.md for how to add one and how to get it live.