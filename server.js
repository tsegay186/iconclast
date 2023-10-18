import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "https://letit.onrender.com"
  }
});

app.use(express.static('dist'))

app.get('/', (req, res) => {
  res.send('hello');
});

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`server running at port ${port}`);
});



const gameWaitingTime =20000
let totalTimeElapsedSinceGameInitiated = 0

const drawnNumberInterval = 1000

let intervalId
let timeoutId

const leaveGameMessage = 'Left The Game.'
const joinGameMessage = 'Joined The Game.'
const gameInitiatorMessage = `game was initiated by you and it will start after ${gameWaitingTime}, but till then you could tell connected clients to join the game.`
const gameInitiatorMessageForClients = `Game Is Initiated. and it will start imediatly after ${gameWaitingTime} seconds. Join Us before the timeout expires and let's Feel The Randomness Together.`

const connectedClients = [];
const winners = new Map()
let PlayersBackUp = new Map()
const playersCombinations = new Map()
const playersSocketIds = new Set()

let gameInitiatorSocketId = undefined
let gameStatus = undefined

const numbersDomain = arrayFromTo(1, 76)
let drawnNumbers = []

function remainingTimeout() {
  return gameWaitingTime - totalTimeElapsedSinceGameInitiated
}

function eventMessage(messageCreator, messageContent) {
  return { clientSocketId: messageCreator, message: messageContent }
}

function onClientConnectsHandler(clientSocket) {

  playersSocketIds.add(clientSocket.id)
  connectedClients.push(clientSocket);
  clientSocket.emit('wellcome', 'Wellcome To The Server, You successfully connected to the server');

}

function clearClientData(clientSocketId) {

  playersCombinations.has(clientSocketId) && playersCombinations.delete(clientSocketId)
  playersSocketIds.has(clientSocketId) && playersSocketIds.delete(clientSocketId)
  clientSocketId == gameInitiatorSocketId && (gameInitiatorSocketId = undefined)

}

function onClientDisconnectsHandler(clientSocket) {

  const clientSocketId = clientSocket.id
  const clientWasPlayer = playersCombinations.has(clientSocket.id)

  clearClientData(clientSocketId)
  connectedClients.splice(connectedClients.indexOf(clientSocket), 1)

  if (clientWasPlayer) {
    const length = clientsWhoJoinedTheGame().length
    if (length >= 1) {
      clientLeftGame(clientSocketId)
    }
  }

  if (connectedClients.length == 0) {

    //every client has been disconnected but server is counting down to start a game. Oh! RUKM ):
    const timeoutRunning = timeoutId && !timeoutId._destroyed
    timeoutRunning && (clearTimeout(timeoutId) || setServerDataStructureForNewRound())

    //there are no clients, but the interval is running.for whom, WTF,  clear it ASAP.
    const intervalRunning = intervalId && !intervalId._destroyed
    intervalRunning && (clearInterval(intervalId) || setServerDataStructureForNewRound())


  }

}

function onClientJoinsGameHandler(clientSocketId, clientCombination) {
  const timeout = remainingTimeout()
  const joiner = findClientBySocketId(clientSocketId)

  // because below block could elapse some time. I give 100 milliseconds lead time for such case
  if (timeout > 100) {

    const joneeClients = clientsWhoJoinedTheGame()

    playersCombinations.set(clientSocketId, clientCombination)

    const allmostAllClients = findAllClientsExcept(clientSocketId)

    const gameWasNotInitiatedYet = !(gameStatus == 'initiated')

    if (gameWasNotInitiatedYet) {


      const event = 'game initiated'
      gameInitiatorSocketId = clientSocketId
      gameStatus = "initiated"

      initiateGame()

      const messageForJoiner = eventMessage(clientSocketId, gameInitiatorMessage)
      const messageForClients = eventMessage(clientSocketId, gameInitiatorMessageForClients)
      eventAnnouncement(event, joiner, messageForJoiner, allmostAllClients, messageForClients)
    }

    else {
      const event = 'someone joined the game'

      const spectator = (gameInitiatorSocketId ?? '80$$') + '   Spectator'
      const someoneJoined = someoneJoinedTheGame(clientSocketId)

      const messageForJoiner = eventMessage(spectator, `You ${joinGameMessage}`)
      const messageForJoinee = eventMessage(spectator, someoneJoined)

      eventAnnouncement(event, joiner, messageForJoiner, joneeClients, messageForJoinee)

    }

  }
  else {
    const event = 'game is on playing'
    const message = eventMessage(clientSocketId, "Game Is On Playing Now. Try Later.")
    emitMessageToClient(joiner, event, message)
  }
}

function someoneJoinedTheGame(clientSocketId) {

  return `${clientSocketId} ${joinGameMessage}`

}


function clientLeftGame(clientSocketId) {

  const event = 'someone left the game'
  const spectator = (gameInitiatorSocketId ?? '80$$') + '   Spectator'
  /*trick the clients that someone(80$$) is a client who is in charge of announcing the game state,
    when the real game initiator left the game or disconnected from the server. */

  const someoneLeftGameMessage = eventMessage(spectator, `${clientSocketId} ${leaveGameMessage}`)
  const gameInitiator = gameInitiatorSocketId && findClientBySocketId(gameInitiatorSocketId)
  const allButGameLeaver = clientsWhoJoinedTheGame().filter(joinee => joinee.id != clientSocketId)

  // game initiator, himself may be left the game or disconnected from the server. then incase just get one active clientSocket to emit announcements
  const eventAnnouncer = gameInitiator || allButGameLeaver[0]
  const allButGameLeaverAndGameAnnouncer = eventAnnouncer && allButGameLeaver.filter((joinee) => joinee.id != eventAnnouncer.id)

  eventAnnouncement(event, eventAnnouncer, someoneLeftGameMessage, allButGameLeaverAndGameAnnouncer, someoneLeftGameMessage)

}

function onClientLeavesGameHandler(clientSocket) {
  const clientSocketId = clientSocket.id

  const event = 'someone left the game'
  const announcerSocketId = (gameInitiatorSocketId ?? '80$$') + '  Spectator';
  const message = 'You Left The Game'
  const messageToGameLeaver = { clientSocketId: announcerSocketId, message }
  clearClientData(clientSocketId)
  // annoucing Game Leaver
  emitMessageToClient(clientSocket, event, messageToGameLeaver)
  // announcing Game Players
  clientLeftGame(clientSocketId)

}

function minuteAndSecondFormatter(totalMilliSeconds) {

  const totalMinutes = Math.floor(totalMilliSeconds / 60000)
  const totalSeconds = (totalMilliSeconds % 60000) / 1000

  const minutes = totalMinutes ? totalMinutes : ''
  const seconds = totalSeconds ? totalSeconds : ''

  const min = minutes ? (`${totalMinutes} minute${totalMinutes > 1 ? 's' : ''}`) : ''
  const sec = seconds ? (`${totalSeconds} second${totalSeconds > 1 ? 's' : ''}`) : ''

  const check = (min || sec)
  const formatted = check ? ((min && sec) ? `${min} and ${sec}` : `${min || sec}`) : ''

  return formatted

}

function initiateGame() {

  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      totalTimeElapsedSinceGameInitiated += 5000
      const timeoutLeft = remainingTimeout()
      const NLPTimeout = minuteAndSecondFormatter(timeoutLeft)
      const gameWillStartMessage = eventMessage(gameInitiatorSocketId ?? '80$$', `Game Is Starting Imediatly After ${NLPTimeout}.`)
      gameWillStartMessage.timeout = timeoutLeft

      timeoutLeft > 0 && connectedClients.forEach(async (client) => {
        await emitMessageToClient(client, 'game will start immediately after', gameWillStartMessage)
      })

      resolve(timeoutId)
    }, 5000)
  })

  timeout.then((timeoutId) => {
    clearInterval(timeoutId)
  }).then(() => {
    if (remainingTimeout() > 0) {
      initiateGame()
    } else {
      startGame()
    }
  })

}

async function startGame() {
  const gameIsStartingEvent = 'game is starting'
  const gameIsStartingMessage = eventMessage(gameInitiatorSocketId ?? '80$$', 'Ready. Game Is Starting Here Now.')

  connectedClients.forEach(async (client) => {
    await emitMessageToClient(client, gameIsStartingEvent, gameIsStartingMessage)
  })

  intervalId = await startTimeInterval()

}

io.on('connection', (socket) => {

  onClientConnectsHandler(socket)

  socket.on('disconnect', () => {
    onClientDisconnectsHandler(socket)
  });



  socket.on('join game', (clientSocketId, clientCombination) => {
    onClientJoinsGameHandler(clientSocketId, clientCombination)
  })

  socket.on('leave game', (clientSocketId) => {

    const client = findClientBySocketId(clientSocketId)
    onClientLeavesGameHandler(client)

  })

  socket.on('update combination', (data) => {
    const key = data && data.clientSocketId
    const value = data && data.clientCombination
    if (key && value) {
      const checkExistence = playersCombinations.has(key)
      checkExistence && playersCombinations.set(key, value)
    }
  })

  socket.on('bingo', async (clientSocketId) => {

    const clientCombination = playersCombinations && playersCombinations.get(clientSocketId)
    const verifyTruthy = clientCombination && clientCombination.every((number) => drawnNumbers.includes(number))

    if (verifyTruthy) {
      clearInterval(intervalId)
      winners.set(clientSocketId, clientCombination)
      const winnerMessage = eventMessage(clientSocketId, 'Congurats, You Won The Game.')

      const event = 'game over'
      const client = findClientBySocketId(clientSocketId)
      await emitMessageToClient(client, event, winnerMessage)

      const allButWinner = findAllClientsExcept(clientSocketId)

      if (allButWinner.length) {
        const messageToAllButWinner = eventMessage(`${gameInitiatorSocketId ?? '80$$'}  Spectator`, `${clientSocketId} Won The Game.`)
        messageToAllButWinner.winnerSocketId = clientSocketId
        messageToAllButWinner.winnerCombination = clientCombination
        allButWinner.forEach(async (connectedClient) => {
          await emitMessageToClient(connectedClient, event, messageToAllButWinner);
        });
      }
      //there is a possibilty that multiple clients could won the game. so instead of imediatly clearing game data, there have to be some delay so that another client could get a chance to say, I also won the game.
      setTimeout(() => {
        setServerDataStructureForNewRound()
      }, 1000)
    }
  })

});

function setServerDataStructureForNewRound() {
  totalTimeElapsedSinceGameInitiated = 0
  drawnNumbers = []
  winners.clear()
  playersCombinations.clear()
  playersSocketIds.clear()
  gameInitiatorSocketId = undefined
  gameStatus = undefined
}

function findClientBySocketId(clientSocketId) {
  return connectedClients.find(client => client.id == clientSocketId)
}

function findAllClientsExcept(clientSocketId) {
  const allBut = connectedClients.filter(connectedClient => connectedClient.id != clientSocketId)
  return allBut
}

function clientsWhoJoinedTheGame() {

  return connectedClients.filter(connectedClient => playersCombinations.has(connectedClient.id))

}

async function startTimeInterval() {

  const interval = setInterval(() => {
    const range = arrayExcluding(numbersDomain, drawnNumbers)

    if (range.length) {
      const drawnNumber = pickRandomNUmber(range);
      drawnNumbers.push(drawnNumber)
      connectedClients.forEach(async (connectedClient) => {
        await emitMessageToClient(connectedClient, 'random number', { drawnNumber, drawnNumbers })
      });
    }
    else {
      // this means that there was not any client who joined the game. announce and set server up for the next round
      connectedClients.forEach(async (connectedClient) => {
        await emitMessageToClient(connectedClient, 'game out of bound', { clientSocketId: '80$$', message: 'Now We Hope That You Notice Some Patterns. Make Your Combination And Get Ready For The Next Round.' })
      });

      clearInterval(intervalId)
      setServerDataStructureForNewRound()

    }

  }, drawnNumberInterval);

  return interval;
}

async function emitMessageToClient(client, emitName, emitData) {
  client && await client.emit(emitName, emitData);
}
function eventAnnouncement(event, eventAnnouncer, messageForeventAnnouncer, eventAnnouncees, messageForeventAnnouncees) {

  (async () => await emitMessageToClient(eventAnnouncer, event, messageForeventAnnouncer))()
  if (eventAnnouncees && eventAnnouncees.length) {
    eventAnnouncees.forEach(async (announcee) => {
      await emitMessageToClient(announcee, event, messageForeventAnnouncees)
    })
  }

}

function arrayFromTo(from, to) {
  let arr = []
  for (let i = from; i < to; i++) {
    arr.push(i)
  }
  return arr
}

function randomInteger(min, max) {
  // here rand is from min to (max+1)
  let rand = min + Math.random() * (max + 1 - min);
  return Math.floor(rand);
}


function arrayWithOut(array, element) {
  let index = array.indexOf(element);
  let temp = [...array];
  index >= 0 ? temp.splice(index, 1) : index
  return temp;
}

function arrayExcluding(array, elements) {
  let temp = [...array];
  for (let element of elements) {
    temp = arrayWithOut(temp, element)
  }
  return temp;
}

function pickRandomNUmber(array) {
  let length = array.length;
  let randomNumber = undefined
  if (length) {
    let firstIndex = 0;
    let lastIndex = length - 1;
    let index = randomInteger(firstIndex, lastIndex);
    randomNumber = array[index]

  }
  return randomNumber
}




