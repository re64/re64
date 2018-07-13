import React, { Component } from 'react';
import './projects.css';

class Projects extends Component {
  constructor() {
    super();
    this.state = {
        projects: []
    }
  }

    componentDidMount() {
        fetch('/api/projects')
            .then(res => res.json())
            .then(projects => this.setState({projects}, () => console.log('Projects fetched...', projects)));
    }
    
  render() {
    return (
      <div>
            <h2>Projects</h2>
            <ul>
            {this.state.projects.map(project => <li key={project.id}>{project.user}/{project.name} {project.title} {project.description}</li>)}
            </ul>
      </div>
    );
  }
}

export default Projects;
