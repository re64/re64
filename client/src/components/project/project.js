import React, { Component } from 'react';
import { Card, Col, Row } from 'antd';
// import './project.css';

class Project extends Component {
  // constructor() {
  //   super();
  //   this.state = {
  //       projects: [] 
  //   }
  // }

  //  componentDidMount() {
  //       fetch('/api/project/x')
  //           .then(res => res.json())
  //           .then(projects => this.setState({projects}, () => console.log('Projects fetched...', projects)));
  //   }
    
    render() {
    return (
      <div>
            <h2>Project {this.props.id}</h2>
      </div>
    );
  }
}

export default Project;
