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
        Pampered is a map of places that welcome dogs: cafés, pubs and restaurants that allow them
        inside, groomers, vets and pet shops, dog parks, off-lead areas and water bowls. It exists
        because the existing directories list a handful of venues with no real data — no opening
        hours, no dog policy, no map worth using — and then put the browsing behind sign-in walls
        and cookie banners.
      </p>

      <h2>Where the data comes from</h2>
      <p>
        Most of it comes from{" "}
        <a href="https://www.openstreetmap.org/copyright" rel="noopener">
          OpenStreetMap
        </a>
        , the free map of the world, under the Open Database Licence. Mappers record a{" "}
        <code>dog=yes</code> tag on venues that allow dogs, and we pull those tags weekly. Every
        venue page says where its data came from and when.
      </p>
      <p>
        The rest is checked by hand. A venue marked <strong>Checked by us</strong> is somewhere a
        person has actually confirmed. A venue marked <strong>Not checked yet</strong> is somewhere
        reported but unconfirmed — shown, but honestly labelled.
      </p>

      <h2>Add a place</h2>
      <p>
        Know somewhere dogs are welcome that is not on the map? The fastest way it gets listed is
        to add it to OpenStreetMap yourself — tag the venue with <code>dog=yes</code> (or{" "}
        <code>dog=outside</code> for outside seating only) and it will appear here on the next
        refresh. If that sounds like work, email the name, address and what you know to{" "}
        <a href="mailto:hello@korg-e.com">hello@korg-e.com</a> and we will check it and add it by
        hand.
      </p>

      <h2>Bookings</h2>
      <p>
        Where a venue takes bookings, the venue page links to whoever already takes them. Pampered
        never takes a booking, never holds a deposit and never charges a venue to appear. There is
        no account, no sign-in, and no tracking beyond what the map tiles need to load.
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