class Game {
    constructor(map, element, rules = { roundCount: 5, distribution: distribution.weighted }) {
        this.element = element;
        this.svElement = new StreetviewElement(element.querySelector('.streetview'));

        this.guessMap = new google.maps.Map(element.querySelector('.embed-map'), {
            zoom: 0,
            center: { lat: 0, lng: 0 },
            disableDefaultUI: true,
            clickableIcons: false,
            backgroundColor: '#aadaff',
            fullscreenControl: false,
        });
        google.maps.event.addListener(this.guessMap, 'click', e => this.placeGuessMarker(e.latLng));

        this.overviewMap = new google.maps.Map(element.querySelector('.overview-map'), {
            zoom: 2,
            center: { lat: 0, lng: 0 },
            disableDefaultUI: true,
            clickableIcons: false,
            backgroundColor: '#aadaff',
            fullscreenControl: false,
        });

        this.setResizeEventListeners();

        this.newGame(map, rules);
    }

    toggleMapOverlay() {
        if (this.map.polygon.getMap()) {
            game.map.polygon.setMap(null);
        } else {
            game.map.polygon.setMap(game.guessMap);
        }
    }

    setResizeEventListeners() {
        let resizeElement = this.element.querySelector('.guess-map-resizer');
        let resizerDown = false;
        let guessMap = this.element.querySelector('.guess-map');

        let onMove = (x, y) => {
            if (resizerDown) {
                let height = window.innerHeight - y - this.element.offsetTop;
                let width = x - this.element.offsetLeft;
                guessMap.style.height = height + 'px';
                guessMap.style.width = width + 'px';
            }
        };
        let onDown = () => {
            resizerDown = true;
        }
        let onUp = () => {
            resizerDown = false;
        }

        resizeElement.addEventListener('mousedown', () => onDown());
        document.addEventListener('mousemove', e => onMove(e.pageX, e.pageY));
        document.addEventListener('mouseup', () => onUp());

        resizeElement.addEventListener('touchstart', () => onDown());
        document.addEventListener('touchmove', e => onMove(e.touches[0].pageX, e.touches[0].pageY));
        document.addEventListener('touchend', () => onUp());
    }

    newGame(map = false, rules = false) {
        if (this.overviewLines)
            this.removeOverviewLines();

        if (rules !== false) {
            this.rules = rules;
        }

        if (map !== false) {
            this.map = map;
            this.streetview = new Streetview(map, this.rules.distribution);
        }

        this.zoom = 14;
        this.currentRound = 0;
        this.events = {};
        this.overviewLines = [];
        this.previousGuesses = [];

        this.preloadNextMap();
        this.nextRound();

        let button = this.element.querySelector('.play-again-button');
        button.innerText = 'Loading...';

        this.once('nextRound', () => {
            let overviewElement = this.element.querySelector('.guess-overview');
            overviewElement.style.transform = 'translateY(-100%)';

            setTimeout(() => {
                button.innerText = 'Play Again';
            }, 300);
        })
    }

    showRoundOverview(guess, actual) {
        let overviewElement = this.element.querySelector('.guess-overview');
        overviewElement.style.transform = 'translateY(0%)';

        overviewElement.querySelector('.next-round-button').style.display = 'inline-block';
        overviewElement.querySelector('.game-end-buttons').style.display = 'none';

        let distance = this.measureDistance(guess, actual);
        let niceDistance = this.formatDistance(distance);
        let score = this.map.scoreCalculation(distance);

        this.previousGuesses.push({
            guess, actual, score
        });

        let [meterElement, scoreElement] = overviewElement.querySelectorAll('.score-text p');
        meterElement.innerText = `Your guess is ${niceDistance} removed from your start location`;
        scoreElement.innerText = `You scored ${score} points`;

        this.fitMap([guess, actual]);

        setTimeout(() => {
            overviewElement.querySelector('.score-progress').style.width = (score / this.map.maxScore * 100) + '%';
            this.removeOverviewLines();
            this.addOverviewLine(guess, actual, 600);
        }, 300);
    }

    showGameOverview(guess, actual) {
        let overviewElement = this.element.querySelector('.guess-overview');
        overviewElement.style.transform = 'translateY(0%)';

        overviewElement.querySelector('.next-round-button').style.display = 'none';
        overviewElement.querySelector('.game-end-buttons').style.display = 'block';

        let distance = this.measureDistance(guess, actual);
        let niceDistance = this.formatDistance(distance);
        let score = this.map.scoreCalculation(distance);

        this.previousGuesses.push({
            guess, actual, score
        });

        let totalScore = this.previousGuesses.map(result => result.score).reduce((a, b) => a + b);
        let maxScore = this.map.maxScore * this.rules.roundCount;

        let [meterElement, scoreElement] = overviewElement.querySelectorAll('.score-text p');
        meterElement.innerText = `Your latest guess is ${niceDistance} removed from your start location`;
        if (score === 1) {
            scoreElement.innerText = `You scored a point, which brings your total score to ${totalScore} points`;
        } else {
            scoreElement.innerText = `You scored ${score} points, which brings your total score to ${totalScore} points`;
        }

        let locations = this.previousGuesses.map(result => result.guess).concat(this.previousGuesses.map(result => result.actual));
        this.fitMap(locations);

        setTimeout(() => {
            overviewElement.querySelector('.score-progress').style.width = (score / this.map.maxScore * 100) + '%';
            this.removeOverviewLines();
            for (let result of this.previousGuesses)
                this.addOverviewLine(result.guess, result.actual, 600);
        }, 300);
    }

    fitMap(positions) {
        let bounds = new google.maps.LatLngBounds();
        for (let location of positions) {
            bounds.extend({
                lat: location[0],
                lng: location[1]
            });
        }
        this.overviewMap.fitBounds(bounds);
    }

    nextRoundButton() {
        let button = this.element.querySelector('.next-round-button');
        button.innerText = 'Loading...';

        this.once('nextRound', () => {
            let overviewElement = this.element.querySelector('.guess-overview');
            overviewElement.style.transform = 'translateY(-100%)';

            setTimeout(() => {
                button.innerText = 'Next Round';
            }, 300);
        })
        this.nextRound();
    }

    nextRound() {

        // Check if next destination is loaded
        if (!this.mapLoaded) {
            console.log("Waiting for map to load");
            this.once('preload', () => this.nextRound());
            return;
        }
        this.currentDestination = this.nextDestination;
        this.disableGuessButton();
        this.guessMap.setZoom(0);
        this.guessMap.setCenter({ lat: 0, lng: 0 });

        if (++this.currentRound < this.rules.roundCount)
            this.preloadNextMap();

        setTimeout(() => {
            this.fire('nextRound');
        }, 500);
        this.svElement.setLocation(...this.currentDestination);
    }

    removeOverviewLines() {
        for (let lineData of this.overviewLines) {
            lineData.line.setMap(null);
            lineData.guess.setMap(null);
            lineData.actual.setMap(null);
        }
    }

    addOverviewLine(guess, actual, animationTime = 1500) {
        guess = { lat: guess[0], lng: guess[1] };
        actual = { lat: actual[0], lng: actual[1] };

        let lineData = {};
        this.overviewLines.push(lineData);

        lineData.line = new google.maps.Polyline({
            path: [guess, guess],
            geodesic: true,
            strokeColor: 'red',
            strokeOpacity: 0.8,
            strokeWeight: 3,
            map: this.overviewMap
        });

        let dropTime = 250;
        let fps = 30;
        let steps = fps * (animationTime / 1000);
        let step = 0;
        let deltaLat = guess.lat - actual.lat;
        let deltaLng = guess.lng - actual.lng;

        lineData.guess = new google.maps.Marker({
            position: guess,
            map: this.overviewMap,
            animation: google.maps.Animation.DROP,
            title: 'Your guess',
        });

        setTimeout(() => {
            let interval = self.setInterval(() => {
                if (step++ >= steps) {
                    clearInterval(interval);
                    lineData.line.setPath([guess, actual]);
                    return;
                }

                lineData.line.setPath([
                    guess,
                    {
                        lat: guess.lat - deltaLat * (step / steps),
                        lng: guess.lng - deltaLng * (step / steps),
                    }
                ]);
            }, 1000 / fps);
        }, dropTime);

        setTimeout(() => {
            lineData.actual = new google.maps.Marker({
                position: actual,
                animation: google.maps.Animation.DROP,
                icon: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png',
                title: 'Actual location',
            });
            lineData.actual.setMap(this.overviewMap);
        }, animationTime);
    }

    disableGuessButton() {
        let button = this.element.querySelector('.guess-button');
        button.style.pointerEvents = 'none';
        button.style.filter = 'grayscale(90%)';
    }

    enableGuessButton() {
        let button = this.element.querySelector('.guess-button');
        button.style.pointerEvents = 'all';
        button.style.filter = 'grayscale(0%)';
    }

    measureDistance(from, to) {
        return google.maps.geometry.spherical.computeDistanceBetween(new google.maps.LatLng(...from), new google.maps.LatLng(...to));
    }

    makeGuess() {
        if (this.marker === undefined)
            return;
        this.marker.setMap(null);

        let guessLocation = [this.marker.position.lat(), this.marker.position.lng()];

        if (this.currentRound === this.rules.roundCount) {
            this.showGameOverview(guessLocation, this.currentDestination);
        } else {
            this.showRoundOverview(guessLocation, this.currentDestination);
        }
    }

    formatDistance(meters) {
        if (meters < 1000) {
            return `${Math.floor(meters * 10) / 10} m`;
        }
        if (meters < 20000) {
            return `${Math.floor(meters / 100) / 10} km`;
        }
        return `${Math.floor(meters / 1000)} km`;
    }

    placeGuessMarker(location) {
        if (this.marker !== undefined) {
            this.marker.setMap(null);
        }

        this.marker = new google.maps.Marker({
            position: location,
            map: this.guessMap
        });
        this.enableGuessButton();
    }

    returnHome() {
        this.svElement.setLocation(...this.currentDestination);
    }

    preloadNextMap() {
        console.log("Loading new location");
        this.mapLoaded = false;
        this.streetview.randomValidLocation(this.zoom).then(next => {
            this.nextDestination = next;
            this.mapLoaded = true;
            console.log("New location found!");
            this.fire('preload');
        });
    }

    fire(event) {
        if (this.events[event]) {
            for (let callback of this.events[event]) {
                callback();
            }
        }
    }

    once(event, callback) {
        let onceCallback;
        onceCallback = () => {
            callback();
            this.off(event, onceCallback);
        }
        this.on(event, onceCallback);
    }

    on(event, callback) {
        if (!this.events[event])
            this.events[event] = [];
        this.events[event].push(callback);
    }

    off(event, callback) {
        if (event in this.events) {
            this.events[event].splice(this.events[event].indexOf(callback), 1);
        } else {
            console.warn(`Trying to remove ${event} event, but it does not exist`);
        }
    }
}