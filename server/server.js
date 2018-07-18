import express from 'express'

const app = express();

app.get('/api/projects', (req, res) => {
    const projects = [
        { id: 1, user: "lambdafu", name: "bardstale1", title: "Bard's Tale I", description: "The Bard's Tale (EA), 1985", url: "https://de.wikipedia.org/wiki/The_Bard%E2%80%99s_Tale" },
        { id: 2, user: "example", name: "project", title: "Example Project", description: "", url: "" },
        { id: 3, user: "somebody", name: "test", title: "", description: "Test", url: "" },
    ];
    res.json(projects);
});

const port = 5000;

app.listen(port, () => console.log(`Server started on ${port}`));

