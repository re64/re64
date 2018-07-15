import React, { Component } from 'react';
import { Card, Col, Row } from 'antd';
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
<Row gutter={16}>
            {this.state.projects.map(project =>
                                     <Col key={project.id} span={8}>
                                     <Card title={project.title} bordered={true}>{project.user}/{project.name} {project.description}</Card>
                                     </Col>
)}
    </Row>
      </div>
    );
  }
}

export default Projects;
