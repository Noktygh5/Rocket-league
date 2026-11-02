# How to join Turboball (and how it's hosted)

Turboball is a car-soccer game that runs in your web browser. There is nothing to download or install.

## Joining a game

1. Open the link Nikhil sent you (it looks like `https://something.free.pinggy.net`). Use a laptop or desktop with a keyboard; Chrome works best.
2. Click **PLAY ONLINE** and type a name.
3. Pick one:
   - **Create a room**: choose 1 v 1, 2 v 2 or 3 v 3. You get a **5-letter code**. Send it to your friends.
   - **Join a room**: type the 5-letter code you were given and press **JOIN**.
4. In the lobby, pick your team (click **JOIN TEAM** on the side you want). Everyone except the host presses **READY**, then the host presses **START MATCH**.

Rooms hold up to 6 players (3 v 3). 3 v 3 is a **beta** on a bigger map, so expect rough edges. Tell Nikhil what you think with **GIVE NIKHIL FEEDBACK** on the main menu.

## How it's hosted (why the link sometimes changes)

The game is **not on a big cloud server**. It runs on Nikhil's own laptop:

- The laptop runs the game server. It decides where every car and the ball are, 120 times a second, so everyone sees the same match.
- A free **tunnel** gives that laptop a public web address, so your browser can reach it from anywhere. You are connecting to the laptop, through the tunnel.

What that means for you:

- **The laptop has to be on, awake and online.** If it sleeps or loses internet, the game disappears for everyone.
- **The link changes about once an hour.** The free tunnel drops and reconnects with a new address. If your link stops working, ask Nikhil for the new one. A match already in progress ends when the tunnel drops.
- **Lag depends on two things:** how far you are from Nikhil, and the speed of his home internet. Everyone's connection runs through his laptop. The game copes with around 100 ms of delay.
- **Nothing is installed on your computer.** The server keeps your chosen name for the match, and anything you type into the feedback box. It does not store accounts or passwords.

## For the host (Nikhil)

Run `./host-beta.sh` from the project folder. It builds the game, starts the server on port 8081, opens the tunnel, and prints `SHARE THIS LINK: ...`. When the tunnel drops it reconnects and prints the new link, so re-share it. Press Ctrl+C to stop. Keep the laptop plugged in with sleep turned off while people play.

Feedback is saved to `server/feedback.jsonl`. Read it at `http://localhost:8081/feedback?key=<contents of server/.feedback-key>`. Keep that key private.
