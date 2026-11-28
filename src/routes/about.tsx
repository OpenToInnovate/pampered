/**
 * About, sources, and how to get a place listed. The page that answers "where
 * does this data come from and why should I trust it" before anyone has to ask.
 */
import { Title } from "@solidjs/meta";

export default function About() {
  return (
    <main class="page">
      <Title>About — Pampered</Title>
      <h1>About Pampered</h1>
      <p>
        Pampered is a map of places that welcome dogs: cafés, pubs, bars and restaurants that allow
        them inside, groomers and pet shops that allow dogs, dog parks and off-lead areas and water
        bowls.
        A place only appears if someone has recorded that dogs are welcome there. Places with no
        dog information are left off rather than shown with a shrug.
      </p>

      <h2>Where the data comes from</h2>
      <p>
        Most of it comes from{" "}
        <a href="https://www.openstreetmap.org/copyright" rel="noopener">
          OpenStreetMap
        </a>
        , the free map of the world, under the Open Database Licence. Mappers record a{" "}
        <code>dog=yes</code> tag on venues that allow dogs, and we pull those tags when we rebuild
        the map. Every venue page shows the date its dog information was last checked, and
        whether anyone has checked it since. We do not guess: a venue with no dog tag is not on the
        map.
      </p>
      <p>
        The rest is checked by hand. A venue marked <strong>Checked by us</strong> is somewhere a
        person has actually confirmed. A venue marked <strong>Not checked yet</strong> is somewhere
        reported but unconfirmed — shown, but honestly labelled.
      </p>

      <h2>Add a place</h2>
      <p>
        Know somewhere dogs are welcome that is not on the map? The fastest way it gets listed is
        to add it to OpenStreetMap yourself — tag the venue with <code>dog=yes</code> and it will
        appear here on the next refresh. If that sounds like work, email the name, address and what you know to{" "}
        <a href="mailto:hello@korg-e.com">hello@korg-e.com</a> and we will check it and add it by
        hand.
      </p>

      <h2>Bookings</h2>
      <p>
        Where a venue takes bookings, the venue page links to whoever already takes them. Pampered
        never takes a booking, never holds a deposit and never charges a venue to appear. There is
        no account, no sign-in, and no tracking beyond what the map tiles need to load.
      </p>

      <h2 id="sponsorship">Sponsorship and your vet</h2>
      <p>
        You can tell Pampered which veterinary provider you are registered with. It filters the vet
        layer to that provider's practices and shows their health-plan or booking link. The choice
        is saved in your browser only — it is not a cookie, it never leaves your device, and there
        is no account.
      </p>
      <p>
        Where a provider sponsors Pampered, the card says so. Sponsorship never changes the map, the
        chips or the order of results: a sponsor's practices are never ranked above anyone else's,
        and a rating shown on a practice is built only from the details we can verify, never from
        reviews or from whether the provider pays.
      </p>
      <p>
        Vets on the map come from OpenStreetMap, like every other place. A provider being listed is
        not an endorsement, and being absent is not a judgement.
      </p>

      <h2>Corrections</h2>
      <p>
        A venue that has stopped welcoming dogs should leave the map. If the data came from
        OpenStreetMap, correcting it there fixes it everywhere. Otherwise email{" "}
        <a href="mailto:hello@korg-e.com">hello@korg-e.com</a>.
      </p>
    </main>
  );
}