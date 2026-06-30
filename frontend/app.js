const form = document.getElementById("matchup-form");
const results = document.getElementById("results");

const routingByRegion = {
    na1
}

form.addEventListener("submit", function (event) {
    event.preventDefault();

    const formData = new FormData(form);

    const gameName = formData.get("game_name");
    const tagLine = formData.get("tag_line");
    const enemyChampion = formData.get("enemy_champion");
    const region = formData.get("region");

    console.log({
        gameName,
        tagLine,
        enemyChampion,
        region,
    });
});